/**
 * Client-side activity registry. Each activity module exports:
 *   id, icon, accent           – identity and lobby card styling (title/description come from i18n `act.<id>`)
 *   renderOptions(container, { t, lang }) → () => options   – optional setup form shown before starting
 *   mount(root, api) → { onState(state), onEvent?(type, data), onCursor?(pid, x, y), onPlayers?(), destroy?() }
 * Add a new module here and a matching server module in server/activities.
 */
import puzzle from './puzzle.js';
import paint from './paint.js';
import lego from './lego.js';
import guess from './guess.js';
import bluetooth from './bluetooth.js';

export const activities = [puzzle, paint, lego, guess, bluetooth];

export function getActivity(id) {
  return activities.find((a) => a.id === id) || null;
}
