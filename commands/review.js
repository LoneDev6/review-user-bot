const { SlashCommandBuilder } = require('discord.js');
const reviewModal = require('../utils/reviewModal.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('review')
        .setDescription('Leave a review for a member')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user you want to review')
                .setRequired(true)
        ),
    async run(client, interaction) {
        const targetUser = interaction.options.getUser('user');
        reviewModal.open(interaction, targetUser);
    }
};
