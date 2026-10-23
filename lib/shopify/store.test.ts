import { memoryShopifyStore } from "./store";
import { describeShopifyStoreContract } from "./store-contract";

describeShopifyStoreContract("memoryShopifyStore", async () => ({
  store: memoryShopifyStore(),
  projectA: "project-a",
  projectB: "project-b",
  person: "person-1",
}));
