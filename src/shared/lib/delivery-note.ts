import type { SaleDelivery } from "@shared/types/sale";

export type DeliveryNoteBusinessInfo = {
  businessName: string;
  physicalAddress: string | null;
  primaryPhone: string | null;
};

export type DeliveryNoteSourceDocument = {
  /** "Receipt", "Invoice", or "Quotation" — whichever document this delivery belongs to. */
  label: string;
  number: string | null;
  createdAt: string;
};

/**
 * Deliberately has NO fee/cost fields at all — structurally impossible to leak pricing onto the
 * printed note, which is meant to be printed, cut out, and stuck onto a physical package.
 */
export type DeliveryNoteViewModel = {
  businessName: string;
  businessAddress: string | null;
  businessPhone: string | null;
  deliveryNoteNumber: string;
  sourceDocumentLabel: string;
  sourceDocumentNumber: string | null;
  dateLabel: string;
  recipientName: string;
  country: string | null;
  town: string | null;
  deliveryAddress: string;
  deliveryNotes: string | null;
  riderName: string | null;
  riderPhone: string | null;
  riderCompany: string | null;
  riderVehicleDescription: string | null;
  isDelivered: boolean;
  deliveredAt: string | null;
};

export function buildDeliveryNoteViewModel(
  delivery: SaleDelivery,
  business: DeliveryNoteBusinessInfo,
  source: DeliveryNoteSourceDocument
): DeliveryNoteViewModel {
  return {
    businessName: business.businessName,
    businessAddress: business.physicalAddress,
    businessPhone: business.primaryPhone,
    deliveryNoteNumber: delivery.deliveryNoteNumber,
    sourceDocumentLabel: source.label,
    sourceDocumentNumber: source.number,
    dateLabel: new Date(source.createdAt).toLocaleString(),
    recipientName: delivery.recipientName,
    country: delivery.country,
    town: delivery.town,
    deliveryAddress: delivery.physicalAddress,
    deliveryNotes: delivery.notes,
    riderName: delivery.riderName,
    riderPhone: delivery.riderPhone,
    riderCompany: delivery.riderCompany,
    riderVehicleDescription: delivery.riderVehicleDescription,
    isDelivered: delivery.isDelivered,
    deliveredAt: delivery.deliveredAt
  };
}
