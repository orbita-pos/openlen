import { memoryEmailStore } from "./store";
import { describeEmailStoreContract } from "./store-contract";

let tick = 0;
describeEmailStoreContract("memoryEmailStore", async () => ({
  store: memoryEmailStore(() => new Date(Date.now() - 1_000_000 + tick++ * 1000)),
  projectA: "project-a",
  projectB: "project-b",
  owner: "owner-1",
}));
