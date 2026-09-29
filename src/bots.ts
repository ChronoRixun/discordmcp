import { Client, GatewayIntentBits, type Guild } from 'discord.js';

/**
 * One MCP server, several bots. Each token becomes its own discord.js client, and every guild lookup searches
 * all of them, so a community can have a bot of its own (its own name, avatar and revocable token) while the
 * tools stay exactly the same: a guild carries its client (`guild.client`), and every tool works from the guild.
 *
 * Tokens come from the environment: DISCORD_TOKEN (one), DISCORD_TOKENS (several, separated by commas,
 * semicolons or newlines) and any DISCORD_TOKEN_<name>. Duplicates are dropped; the order is kept and decides
 * which bot answers when two of them share a guild (the first one listed).
 */
export function tokensFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw: string[] = [];
  if (env.DISCORD_TOKEN) raw.push(env.DISCORD_TOKEN);
  if (env.DISCORD_TOKENS) raw.push(...env.DISCORD_TOKENS.split(/[,;\n]/));
  for (const key of Object.keys(env).sort()) {
    if (/^DISCORD_TOKEN_\w+$/.test(key) && env[key]) raw.push(env[key]!);
  }
  const seen = new Set<string>();
  return raw.map(t => t.trim()).filter(t => t && !seen.has(t) && seen.add(t));
}

/** The minimum of a discord.js Client the pool uses (tests pass fakes). */
export type BotClient = Pick<Client, 'guilds' | 'user'> & {
  login?: Client['login'];
  once?: Client['once'];
};

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
    ],
  });
}

export class BotPool {
  constructor(public readonly clients: BotClient[]) {
    if (clients.length === 0) throw new Error('No Discord bots: set DISCORD_TOKEN, DISCORD_TOKENS or DISCORD_TOKEN_<name>');
  }

  /** Every guild any bot is in, one entry per guild: the first bot that has it wins. */
  guilds(): Guild[] {
    const byId = new Map<string, Guild>();
    for (const client of this.clients) {
      for (const guild of client.guilds.cache.values()) {
        if (!byId.has(guild.id)) byId.set(guild.id, guild);
      }
    }
    return Array.from(byId.values());
  }

  /** "name (id) - via BotTag" for every guild, for error messages and list-servers. */
  describe(): string[] {
    return this.guilds().map(g => `"${g.name}" (${g.id}) via ${(g.client as BotClient).user?.tag ?? 'unknown bot'}`);
  }

  /** A guild by ID (exact) or by name (case-insensitive, must be unique), across every bot. */
  async findGuild(identifier?: string): Promise<Guild> {
    const all = this.guilds();
    if (!identifier) {
      if (all.length === 1) return all[0];
      throw new Error(`The bots are in ${all.length} servers. Please specify server name or ID. Available servers: ${this.describe().join(', ')}`);
    }
    const byId = all.find(g => g.id === identifier);
    if (byId) return byId;
    if (/^\d{15,22}$/.test(identifier)) {
      // Not cached (a very fresh invite): ask each bot, in order.
      for (const client of this.clients) {
        try {
          return await client.guilds.fetch(identifier);
        } catch {
          /* the next bot may have it */
        }
      }
    }
    const matches = all.filter(g => g.name.toLowerCase() === identifier.toLowerCase());
    if (matches.length === 0) {
      throw new Error(`Server "${identifier}" not found. Available servers: ${this.describe().join(', ') || 'none - invite a bot first'}`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple servers found with name "${identifier}": ${matches.map(g => `${g.name} (ID: ${g.id})`).join(', ')}. Please specify the server ID.`);
    }
    return matches[0];
  }

  /** Log every bot in. One bad token is reported and skipped; none at all is fatal. */
  static async login(tokens: string[], log: (line: string) => void = line => console.error(line)): Promise<BotPool> {
    const ready: BotClient[] = [];
    const failures: string[] = [];
    await Promise.all(tokens.map(async (token, i) => {
      const client = createClient();
      try {
        await client.login(token);
        ready.push(client);
        log(`Discord bot ${i + 1}/${tokens.length} ready: ${client.user?.tag ?? '?'} in ${client.guilds.cache.size} server(s)`);
      } catch (error) {
        failures.push(`bot ${i + 1}/${tokens.length}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    for (const f of failures) log(`Discord login failed - ${f}`);
    if (ready.length === 0) throw new Error(`No Discord bot could log in: ${failures.join('; ')}`);
    // Keep the configured order: it decides which bot answers for a guild both bots are in.
    ready.sort((a, b) => tokens.indexOf((a as Client).token ?? '') - tokens.indexOf((b as Client).token ?? ''));
    return new BotPool(ready);
  }
}
