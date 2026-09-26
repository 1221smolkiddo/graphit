import { target as directAlias } from './leaf';
import * as namespace from './leaf';
import { renamed } from './barrel';
import * as barrel from './barrel';
import { publicTarget } from './chain';
import { target as duplicate } from './duplicate';
import { loop } from './cycle-a';
import { changed } from './rebound';
import { direct } from './direct';
import { external } from 'external-package';
export function aliasCall() { return directAlias(); }
export function namespaceCall() { return namespace.target(); }
export function barrelCall() { return renamed(); }
export function chainCall() { return publicTarget(); }
export function namespaceBarrelCall() { return barrel.renamed(); }
export function ambiguousCall() { return duplicate(); }
export function cycleCall() { return loop(); }
export function reboundCall() { return changed(); }
export function unsupportedCall() { return direct(); }
export function externalCall() { return external(); }
export function shadowCall(renamed: () => number) { return renamed(); }
export function dynamicCall(object: any) { return object.target(); }
