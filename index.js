require('dotenv').config();

const { Client, Collection, Events, GatewayIntentBits, Partials } = require('discord.js');
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

client.postReview = async function (guildId, userId, authorId, review, rating, notificationMessageId) {
    const timestamp = new Date().toISOString();
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
    return db.prepare(`
        SELECT user_id, AVG(rating) as avg_rating, COUNT(*) as reviews_count
        FROM reviews
        GROUP BY user_id
        ORDER BY avg_rating DESC, reviews_count DESC
        LIMIT ?
    `).all(limit);
};

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
