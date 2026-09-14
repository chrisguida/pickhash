import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_1_4_2 = VersionInfo.of({
  version: '0.1.4:2',
  releaseNotes: {
    en_US:
      'Fixes a stratum username that some pools cannot credit. Rentals used to connect as your-address-r<rental-id>. Ocean accepts that form, but Convoy — the main BLAKE2b pool — serves work for it and cannot read an address out of it, so hashrate you had paid for was mined and credited to nobody. Nothing showed it: MiningRigRentals sees a fully-delivering rental, so there is no underdelivery to detect and no refund to claim. Rentals now connect as your-address.r<rental-id> — one period, no dash — which every pool tested accepts. Rentals already running are corrected in place on the first tick after updating, carrying their per-rig difficulty through, so remaining hours are attributed rather than lost; rentals that have already ended cannot be recovered. A bare Bitcoin address is now a complete answer in the endpoint field, since Pickhash adds the worker name itself.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
