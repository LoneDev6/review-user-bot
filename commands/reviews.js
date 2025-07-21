const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reviews')
        .setDescription('Read the reviews of a member or show the leaderboard')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user you want to check')
                .setRequired(false)
        ),
    async run(client, interaction) {
        const config = client.config;
        const targetUser = interaction.options.getUser('user');
        if (!targetUser) {
            // Get top 10 users with best reviews using precalculated data
            const topUsers = await client.getTopUsers(10);
            if (!topUsers || topUsers.length === 0) {
                return interaction.reply({
                    content: "No reviews available.",
                    ephemeral: true
                });
            }

            let leaderboard = '';
            for (let i = 0; i < topUsers.length; i++) {
                const user = await client.users.fetch(topUsers[i].user_id).catch(() => null);
                const username = user ? user.tag : `Unknown (${topUsers[i].user_id})`;
                leaderboard += `**${i + 1}. ${username}** — ${Number(topUsers[i].avg_rating).toFixed(2)}/5 ⭐ (${topUsers[i].reviews_count} reviews)\n`;
            }

            const embed = new EmbedBuilder()
                .setTitle('Top 10 Best Reviewed Users')
                .setDescription(leaderboard || 'No reviews available.')
                .setColor(config.embed.color);

            return await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }

        const reviews = await client.getReviewsForUser(targetUser.id);
        if (!reviews || reviews.length === 0) {
            return interaction.reply({
                content: `No reviews found for ${targetUser.tag}.`,
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`Reviews for ${targetUser.tag}`)
            .setColor(config.embed.color);

        let currentPage = 0;
        const getPageReviews = (page) => {
            const start = page * 10;
            const end = start + 10;
            return reviews.slice(start, end);
        };

        const getReviewList = (pageReviews, startIndex) => {
            let reviewList = '';
            pageReviews.forEach((review, index) => {
                reviewList += `**${startIndex + index + 1}.** ${review.rating}/5 ⭐ - https://discord.com/channels/${config.guildId}/${config.reviewChannel}/${review.notification_message_id}\n`;
            });
            return reviewList || 'No reviews available.';
        };

        const pageReviews = getPageReviews(currentPage);
        embed.setDescription(getReviewList(pageReviews, currentPage * 10));

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(reviews.length <= 10)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });

        const filter = i => i.customId === 'previous' || i.customId === 'next';
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'These buttons aren\'t for you!', ephemeral: true });

            if (i.customId === 'next') {
                currentPage++;
            } else if (i.customId === 'previous') {
                currentPage--;
            }

            const totalPages = Math.ceil(reviews.length / 10);
            const pageReviews = getPageReviews(currentPage);
            embed.setDescription(getReviewList(pageReviews, currentPage * 10));
            row.components[0].setDisabled(currentPage === 0);
            row.components[1].setDisabled(currentPage >= totalPages - 1);

            await i.update({ embeds: [embed], components: [row] });
        });

        collector.on('end', () => {
            interaction.editReply({ components: [] });
        });
    }
};
