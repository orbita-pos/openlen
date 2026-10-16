import { memorySecurityReviewStore } from "./store";
import { describeStoreContract } from "./store-contract";

describeStoreContract("memory", async () => ({ store: memorySecurityReviewStore(), projectA: "pa", projectB: "pb" }));
