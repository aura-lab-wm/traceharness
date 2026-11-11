import { MEMBER } from '../member-api'

// Never read or migrate a previous visitor's unscoped annotations in member mode.
export const memberStorageKey = (localKey) => MEMBER ? `rig.member.${MEMBER.scope}.${localKey}` : localKey
