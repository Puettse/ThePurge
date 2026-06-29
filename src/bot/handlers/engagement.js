export async function handleRank(context, interaction) {
  const result = await context.db.query(
    'SELECT xp, level FROM levels WHERE guild_id = $1 AND user_id = $2',
    [interaction.guild.id, interaction.user.id],
  );
  const row = result.rows[0] || { xp: 0, level: 0 };
  await interaction.reply({ content: `Level ${row.level}, ${row.xp} XP.`, ephemeral: true });
}

export async function handleEconomy(context, interaction) {
  const result = await context.db.query(
    `
    INSERT INTO economy_accounts (guild_id, user_id)
    VALUES ($1, $2)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET updated_at = NOW()
    RETURNING cash, bank;
    `,
    [interaction.guild.id, interaction.user.id],
  );
  const row = result.rows[0];
  await interaction.reply({ content: `Cash: ${row.cash}. Bank: ${row.bank}.`, ephemeral: true });
}
