import { E2eContext } from './helpers/e2e-context';

export default async function globalTeardown() {
  await E2eContext.teardown();
}
