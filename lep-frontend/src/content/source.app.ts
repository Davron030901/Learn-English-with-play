import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { contentAssets } from './assets.generated';
import type { ContentSource } from './repository';

/**
 * Reads the packed content that ships with the app. The files are Metro *assets* (`.lep`), so
 * none of the 16 MB is in the JavaScript bundle (brief §15). On the web an asset is a URL served
 * next to the bundle; on iOS and Android it is a file in the app package, read through
 * expo-file-system (there is no file system on the web, hence the split).
 */
async function readAsset(moduleId: number | string): Promise<unknown> {
  const asset = Asset.fromModule(moduleId);
  if (Platform.OS === 'web') {
    const res = await fetch(asset.uri);
    if (!res.ok) throw new Error(`content asset ${asset.name} answered ${res.status}`);
    return res.json();
  }
  if (!asset.localUri) await asset.downloadAsync();
  const text = await new File(asset.localUri ?? asset.uri).text();
  return JSON.parse(text) as unknown;
}

const units = contentAssets.units as Readonly<Record<string, number | string>>;

export const appContentSource: ContentSource = {
  read: (name) => readAsset(contentAssets[name] as number | string),
  readUnit: (unitId) => {
    const mod = units[unitId];
    if (mod === undefined) return Promise.reject(new Error(`no such unit ${unitId}`));
    return readAsset(mod);
  },
};
