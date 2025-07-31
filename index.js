require('dotenv').config();

const { Client, Collection, Events, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const chalk = require('chalk');
const Database = require('better-sqlite3');

const config = require('./config.js');
const commandReview = require('./commands/review.js');
const commandReviews = require('./commands/reviews.js');
const reviewModal = require('./utils/reviewModal.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

client.config = config;
client.commands = new Collection();

const db = initDb();

function initDb() {
    const db = new Database('./data/reviews.db');
    db.prepare(`
        CREATE TABLE IF NOT EXISTS reviews (
            guild_id TEXT,
            user_id TEXT,
            author_id TEXT,
            review TEXT,
            rating INTEGER,
            timestamp TEXT,
            notification_message_id TEXT
        )
    `).run();
    return db;
}

client.postReview = async function (guildId, userId, authorId, review, rating, notificationMessageId, timestamp = undefined) {
    if(!timestamp) {
        timestamp = new Date().toISOString();
    }
    db.prepare(`
        INSERT OR REPLACE INTO reviews (guild_id, user_id, author_id, review, rating, timestamp, notification_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, userId, authorId, review, rating, timestamp, notificationMessageId);
};

client.getReviewsForUser = async function (userId) {
    return db.prepare('SELECT * FROM reviews WHERE user_id = ?').all(userId);
};

client.getReviewsOfAuthor = async function (authorId) {
    return db.prepare('SELECT * FROM reviews WHERE author_id = ?').all(authorId);
}

client.getLastReviewOfAuthor = async function (authorId) {
    return db.prepare('SELECT * FROM reviews WHERE author_id = ? ORDER BY timestamp DESC LIMIT 1').get(authorId);
}

client.getTopUsers = async function (limit) {
    // Returns normalized top users based on average rating and number of reviews
    return db.prepare(`
        SELECT user_id, 
               AVG(rating) AS avg_rating, 
               COUNT(*) AS reviews_count, 
               SUM(rating) AS total_rating,
               LOG(COUNT(*) + 1) AS log_reviews,
               (SUM(rating) / LOG(COUNT(*) + 1)) AS adjusted_score
        FROM reviews
        GROUP BY user_id
        ORDER BY adjusted_score DESC
        LIMIT ?
    `).all(limit);
};

async function loadMissingReviews(guild) {
    const reviewChannel = guild.channels.cache.get(config.reviewChannel);
    if (!reviewChannel || !reviewChannel.isTextBased()) {
        console.log(chalk.red('[ERROR] Review channel not found or is not text-based.'));
        return;
    }

    console.log(chalk.yellow('[INFO] Scanning review channel for missing reviews...'));

    let fetched;
    let lastId;
    let processed = 0;
    let inserted = 0;

    do {
        fetched = await reviewChannel.messages.fetch({ limit: 100, before: lastId });
        lastId = fetched.last()?.id;

        for (const message of fetched.values()) {
            if (!message.embeds.length) continue;

            const embed = message.embeds[0];
            if (!embed.data.fields) continue;

            const ratingField = embed.data.fields.find(f => f.name === "Rating");
            const feedbackField = embed.data.fields.find(f => f.name === "Feedback");
            const reviewedUserField = embed.data.fields.find(f => f.name === "Reviewed User");
            const reviewerField = embed.data.fields.find(f => f.name === "Reviewer");

            if (!ratingField || !feedbackField || !reviewedUserField || !reviewerField) continue;

            const reviewedUserId = reviewedUserField.value.replace(/[<@>]/g, "");
            const authorId = reviewerField.value.replace(/[<@>]/g, "");
            const feedback = feedbackField.value;
            const ratingMatch = ratingField.value.match(/\((\d)\/5\)/);
            const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : null;

            if (!reviewedUserId || !authorId || !rating) continue;

            // Calculate if the review already exists in the same day
            const existing = db.prepare(`
                SELECT * FROM reviews
                WHERE guild_id = ? AND user_id = ? AND author_id = ?
                AND DATE(timestamp) = DATE(?)
            `).get(guild.id, reviewedUserId, authorId, message.createdAt.toISOString());

            if (!existing) {
                client.postReview(
                    guild.id,
                    reviewedUserId,
                    authorId,
                    feedback,
                    rating,
                    message.id,
                    message.createdAt.toISOString()
                );
                inserted++;
                console.log(chalk.green(`[INFO] Inserted review for user ${reviewedUserId} by author ${authorId} on ${message.createdAt.toISOString()}`));
            } else {
                console.log(chalk.yellow(`[WARN] Review already exists for user ${reviewedUserId} by author ${authorId} on ${message.createdAt.toISOString()}`));
            }

            processed++;
        }
    } while (fetched.size >= 100);

    console.log(chalk.green(`[INFO] Scan complete. Processed: ${processed}, Inserted new: ${inserted}`));
}

client.once(Events.ClientReady, async () => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
        console.log(chalk.red('[ERROR] Guild not found!'));
        process.exit(1);
    }

    console.log(chalk.green(`[READY] ${client.user.tag} is online!`));

    // To delete commands in case you want to reset them
    // Uncomment the following lines if you want to clear existing commands
    // client.application.commands.set([]);
    // guild.commands.set([]);

    client.commands.set(commandReview.data.name, commandReview);
    client.commands.set(commandReviews.data.name, commandReviews);

    await guild.commands.create(commandReview.data);
    await guild.commands.create(commandReviews.data);

    console.log('[DEBUG] Commands deployed!');

    // Set the status of the bot to a waifu message
    client.user.setPresence({
        activities: [{ name: 'you~ ^-^', type: ActivityType.Watching }],
        status: 'online'
    });
    console.log(chalk.green('[INFO] Bot status set to "Watching you~ ^-^"'));

    // Load missing reviews from the review channel
    loadMissingReviews(guild);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.run(client, interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'review-user-modal') {
        reviewModal.handle(interaction, client, config);
    }
});

// On message delete, delete the review from the database
client.on(Events.MessageDelete, async (message) => {
    if (message.channel.id !== config.reviewChannel) return;

    const review = db.prepare('SELECT * FROM reviews WHERE notification_message_id = ?').get(message.id);
    if (review) {
        db.prepare('DELETE FROM reviews WHERE notification_message_id = ?').run(message.id);
        console.log(chalk.green(`[INFO] Review deleted for message ID: ${message.id}`));
    } else {
        console.log(chalk.yellow(`[WARN] No review found for deleted message ID: ${message.id}`));
    }
});

// Login
client.login(process.env.BOT_TOKEN).catch(e => {
    console.log(chalk.red(`[ERROR] There is an error with the token\n ${e}`));
    process.exit(1);
});
