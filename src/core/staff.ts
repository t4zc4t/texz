import type { Store } from '../db.js';
import type { Ctx } from './ctx.js';

// the staff roles an admin picked in /setup, on top of everyone with Manage Server
export const staffRoles = (store: Store, gid: string | null) => (gid ? JSON.parse(store.getKv(`staffroles:${gid}`) ?? '[]') as string[] : []);
export const isStaff = (store: Store, ctx: Pick<Ctx, 'isAdmin' | 'guildId' | 'member'>) => ctx.isAdmin || staffRoles(store, ctx.guildId).some((id) => ctx.member?.roles.cache.has(id));
