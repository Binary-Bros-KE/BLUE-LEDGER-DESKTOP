import * as dropshipRepository from "@main/database/repositories/dropship-repository";
import type { DropshipState } from "@shared/types/dropship";

/** Renderer read for the "Supplier stock" badge. Just names and a timestamp — no permission gate, the
 * same way the product list itself is readable by anyone who can see that screen. */
export function getDropshipState(): DropshipState {
  return {
    links: dropshipRepository.listDropshipLinks(),
    suppliers: dropshipRepository.readDropshipState()?.suppliers ?? []
  };
}
