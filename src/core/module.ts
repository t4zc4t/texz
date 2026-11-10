import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Store } from '../db.js';
import type { Ctx } from './ctx.js';

export interface Command {
  name: string;
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  // text form: extra names after the prefix and the order of positional args
  text?: { aliases?: string[]; args?: string[]; sub?: boolean; subArgs?: Record<string, string[]> };
  admin?: boolean;
  // seconds between uses for one person, see cooldownOf in the registry
  cooldown?: number;
  // slash commands are grouped, /owo huntbot instead of /huntbot, so the list stays short
  group?: string;
  // the name inside the group when it differs, /anime search for the "anime" text command
  as?: string;
  // reachable from buttons and text, but no slash command of its own
  hidden?: boolean;
  // how people type it when that's not just the name, like "quiz crest"
  call?: string;
  // what to type after the command in the help example, like "2h drink water"
  example?: string;
  run(ctx: Ctx, store: Store): Promise<unknown>;
}

export interface Module {
  name: string;
  label: string;
  about: string;
  // core can't be switched off, otherwise nobody could switch things back on
  locked?: boolean;
  commands: Command[];
}

// how the command is written as a slash command, like "/owo view:huntbot"
export const slashPath = (c: Command) => (c.group ? `${c.group} view:${c.as ?? c.name}` : c.name);
