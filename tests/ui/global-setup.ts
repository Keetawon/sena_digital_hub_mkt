import { assertDisposableTestDatabase } from '../../scripts/disposable-test-guard.mjs';

export default async function setup() {
  // H1's own runner provisions a separate loopback-only managed-profile cluster.
  // Its config selects only hosted-h1.spec.ts, never the normal local tests.
  if (process.env.HUB_HOSTED_TEST_SIMULATION === '1') {
    const url = new URL(process.env.HUB_DATABASE_URL || '');
    if (url.hostname !== '127.0.0.1' || Number(url.port) < 1024 || url.port === '55432' || url.pathname !== '/hub_hosted_test_simulation') {
      throw new Error('H1 tests require the separate local H1 simulation');
    }
    return;
  }
  await assertDisposableTestDatabase();
}
