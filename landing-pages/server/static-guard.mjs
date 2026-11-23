import path from 'node:path';

/*
 * Which files the static handler may serve, given a path relative to STATIC_ROOT.
 * Pure (no I/O) so it can be tested without starting the server.
 *
 * STATIC_ROOT defaults to the landing-pages folder itself, which also holds the server code,
 * its .env and order log (server/), and build outputs (dist/) that include deploy-only secret
 * files such as dist/*-secret.txt. The sibling cpanel tree is a separate deployment target,
 * not public Node-server content. Keep these directories private on case-insensitive filesystems too.
 */
const BLOCKED_DIRS = /(^|[\\/])(server|node_modules|dist|cpanel)([\\/]|$)/i;

export function isServablePath(relToRoot) {
  if (typeof relToRoot !== 'string' || relToRoot === '') return false;
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return false;
  if (BLOCKED_DIRS.test(relToRoot)) return false;
  if (/(^|[\\/])\./.test(relToRoot)) return false; // dotfiles and dot-directories
  if (/\.md$/i.test(relToRoot)) return false; // docs
  return true;
}
