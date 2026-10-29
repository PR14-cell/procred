import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const standalonePath = join(process.cwd(), '.next', 'standalone');
const standaloneNextPath = join(standalonePath, '.next');

await mkdir(standaloneNextPath, { recursive: true });
await cp(join(process.cwd(), '.next', 'static'), join(standaloneNextPath, 'static'), { recursive: true, force: true });
await cp(join(process.cwd(), 'public'), join(standalonePath, 'public'), { recursive: true, force: true });