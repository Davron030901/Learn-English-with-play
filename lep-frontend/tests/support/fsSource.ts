import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ContentSource } from '@/content/repository';
import { unitFiles } from '@/content/version.generated';

/** Reads the packed content assets straight from disk, for Node tests. */
export const CONTENT_DIR = join(__dirname, '../../assets/content');

const readJson = (file: string): unknown => JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));

export const fsContentSource: ContentSource = {
  read: (name) => Promise.resolve(readJson(`${name}.lep`)),
  readUnit: (unitId) => {
    const stem = (unitFiles as Record<string, string>)[unitId];
    if (!stem) return Promise.reject(new Error(`no such unit ${unitId}`));
    return Promise.resolve(readJson(`${stem}.lep`));
  },
};

export const ALL_UNIT_IDS: string[] = Object.keys(unitFiles);
