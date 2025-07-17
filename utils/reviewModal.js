const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');

async function open(interaction, targetUser) {
    const modal = new ModalBuilder()
        .setCustomId('review-user-modal')
        .setTitle(`${interaction.guild.name} - Reviews`);

    const service = new TextInputBuilder()
        .setCustomId(`review-user-${interaction.member.id}-rate`)
        .setLabel("Rate the service 1-5")
        .setPlaceholder("1-5")
        .setMinLength(1)
        .setMaxLength(1)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const feedback = new TextInputBuilder()
        .setCustomId(`review-user-${interaction.member.id}-feedback`)
        .setLabel("Feedback")
        .setPlaceholder("Your feedback here")
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(50)
        .setMaxLength(2000)
        .setRequired(true);

    const targetUserInput = new TextInputBuilder()
        .setCustomId(`review-user-${interaction.member.id}-target-user-id`)
        .setLabel("User ID")
        .setPlaceholder("0000000000000000")
        .setStyle(TextInputStyle.Short)
        .setMinLength(18)
        .setMaxLength(20)
        .setRequired(true)
        .setValue(targetUser.id);

    const image = new TextInputBuilder()
        .setCustomId(`review-user-${interaction.member.id}-image`)
        .setLabel("Image")
        .setPlaceholder("Image URL")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(256)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(service),
        new ActionRowBuilder().addComponents(feedback),
        new ActionRowBuilder().addComponents(image),
        new ActionRowBuilder().addComponents(targetUserInput)
    );

    await interaction.showModal(modal);
}

async function handle(interaction, client, config) {
    const serviceRating = interaction.fields.getTextInputValue(`review-user-${interaction.member.id}-rate`);
    const feedback = interaction.fields.getTextInputValue(`review-user-${interaction.member.id}-feedback`);
    const image = interaction.fields.getTextInputValue(`review-user-${interaction.member.id}-image`) || null;
    const reviewedUserId = interaction.fields.getTextInputValue(`review-user-${interaction.member.id}-target-user-id`);

    if (isNaN(serviceRating)) {
        return interaction.reply({ content: "The service rating must be a number!", ephemeral: true });
    }
    if (serviceRating < 1 || serviceRating > 5) {
        return interaction.reply({ content: "The service rating must be between 1-5!", ephemeral: true });
    }

    const starRating = '⭐'.repeat(serviceRating);
    const reviewedUser = interaction.guild.members.cache.get(reviewedUserId);
    const reviewedUserImage = reviewedUser ? reviewedUser.user.displayAvatarURL({ dynamic: true }) : null;

    if (!reviewedUserImage) {
        return interaction.reply({ content: "The user you are trying to review does not exist or is not in the server!", ephemeral: true });
    }

    if (reviewedUserId === interaction.member.id) {
        return interaction.reply({ content: "You cannot review yourself!", ephemeral: true });
    }

    // Single review for the same target user the same day.
    const reviewsForUser = await client.getReviewsForUser(reviewedUserId);
    const alreadyReviewedToday = reviewsForUser.some(review => {
        return review.author_id === interaction.member.id &&
        new Date(review.timestamp).toDateString() === new Date().toDateString();
    });
    if (alreadyReviewedToday) {
        return interaction.reply({ content: "You have already reviewed this user today!", ephemeral: true });
    }

    // User can review any user, but cannot post more than 1 review each 6 hours.
    const lastReviewOfAuthor = await client.getLastReviewOfAuthor(interaction.member.id);
    if (lastReviewOfAuthor && (new Date() - new Date(lastReviewOfAuthor.timestamp)) < 2 * 60 * 60 * 1000) {
        return interaction.reply({ content: "You can only review once every 2 hours!", ephemeral: true });
    }

    // Set color based on rating
    let color = 0xED4245; // Default Red
    if (serviceRating >= 4) color = 0x57F287; // Green
    else if (serviceRating == 3) color = 0xFEE75C; // Yellow

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTimestamp()
        .setAuthor({
            name: interaction.member.user.username,
            iconURL: interaction.member.user.displayAvatarURL({ dynamic: true })
        })
        .setThumbnail(reviewedUserImage)
        .addFields(
            { name: "Rating", value: `${starRating} (${serviceRating}/5)`, inline: true },
            { name: "Feedback", value: feedback, inline: false },
            { name: "Reviewed User", value: `<@${reviewedUserId}>`, inline: true },
            { name: "Reviewer", value: `<@${interaction.member.id}>`, inline: true }
        );

    if (image && image.match(/\.(jpeg|jpg|gif|png|webp)$/)) {
        embed.setImage(image);
    }

    const reviewChannel = interaction.guild.channels.cache.get(config.reviewChannel);
    if (!reviewChannel) {
        return interaction.reply({ content: "The review channel was not found!", ephemeral: true });
    }

    const sentNotification = await reviewChannel.send({ embeds: [embed] });
    interaction.reply({ content: "Your review has been submitted!", ephemeral: true });

    client.postReview(interaction.guild.id, reviewedUserId, interaction.member.id, feedback, serviceRating, sentNotification.id);
}

module.exports = { open, handle };