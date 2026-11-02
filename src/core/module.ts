import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Store } from '../db.js';
import type { Ctx } from './ctx.js';

export interface Command {
  name: string;
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  // text form: extra names after the prefix and the order of positional args
  text?: { aliases?: string[]; args?: string[]; sub?: boolean; subArgs?: Record<string, string[]> };
  admin?: boolean;
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
