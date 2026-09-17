// Single source of truth for the store's product-category labels, used to
// build the per-category permission checkboxes on the users/permissions
// page (admin-users.html). Add a category here and it appears there
// automatically next time that page loads — no other file needs to change.
//
// Labels match the storefront's own category names (see the `names` map in
// index.html) so an admin recognizes them. "discount" isn't a real product
// type — it's a cross-cutting permission covering the discount-price field
// on any product — so it's listed separately from PRODUCT_TYPES but still
// included in the combined permission list.
window.VERONZA_PRODUCT_TYPES = [
  { key: 'shoes', label: 'السبيدروات' },
  { key: 'bags', label: 'الشنط' },
  { key: 'set', label: 'السيتات' },
];
window.VERONZA_DISCOUNT_CATEGORY = { key: 'discount', label: 'التخفيضات' };
window.VERONZA_PERMISSION_CATEGORIES = window.VERONZA_PRODUCT_TYPES.concat([
  window.VERONZA_DISCOUNT_CATEGORY,
]);
