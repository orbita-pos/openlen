import { memoryStripeStore } from "./store";
import { describeStripeStoreContract } from "./store-contract";

let tick = 0;
describeStripeStoreContract("memoryStripeStore", async () => ({
  store: memoryStripeStore(() => new Date(1_700_000_000_000 + tick++ * 1000)),
  projectA: "project-a",
  projectB: "project-b",
}));
