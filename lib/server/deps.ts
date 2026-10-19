import type { Principal } from "@/lib/server/authz/authorize";
import type { Database } from "@/lib/server/db/types";
import type { Signer } from "@/lib/server/signing";
import type { ObjectStore } from "@/lib/server/storage";

export interface ServerDeps {
  db: Database;
  store: ObjectStore;
  signer: Signer;
}

export interface Caller {
  deps: ServerDeps;
  principal: Principal;
}
