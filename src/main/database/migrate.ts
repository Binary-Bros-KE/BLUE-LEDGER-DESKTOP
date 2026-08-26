import { getDatabase, runInTransaction } from "./connection";

const migrations = [
  {
    version: 1,
    name: "initial_multi_tenant_pos_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL UNIQUE,
        server_id TEXT,
        business_name TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'KES',
        locale TEXT NOT NULL DEFAULT 'en-KE',
        timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workstations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        server_id TEXT,
        label TEXT NOT NULL,
        device_fingerprint TEXT NOT NULL,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        server_id TEXT,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        barcode TEXT,
        price_cents INTEGER NOT NULL,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        sync_status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, sku),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        server_id TEXT,
        display_name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        sync_status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        server_id TEXT,
        workstation_id TEXT NOT NULL,
        receipt_number TEXT NOT NULL,
        subtotal_cents INTEGER NOT NULL,
        tax_cents INTEGER NOT NULL DEFAULT 0,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'paid',
        sync_status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, receipt_number),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (workstation_id) REFERENCES workstations(id)
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        product_id TEXT,
        label TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id)
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        server_id TEXT,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'push',
        status TEXT NOT NULL DEFAULT 'queued',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_sales_tenant_created ON sales(tenant_id, created_at);
    `
  },
  {
    version: 2,
    name: "single_tenant_business_profile",
    sql: `
      ALTER TABLE tenants RENAME TO tenant;

      ALTER TABLE tenant DROP COLUMN branch_name;
      ALTER TABLE tenant DROP COLUMN locale;
      ALTER TABLE tenant DROP COLUMN timezone;
      ALTER TABLE tenant DROP COLUMN sync_enabled;

      ALTER TABLE tenant ADD COLUMN business_logo_path TEXT;
      ALTER TABLE tenant ADD COLUMN business_registration_number TEXT;
      ALTER TABLE tenant ADD COLUMN kra_pin TEXT;
      ALTER TABLE tenant ADD COLUMN primary_phone TEXT;
      ALTER TABLE tenant ADD COLUMN alternative_phone TEXT;
      ALTER TABLE tenant ADD COLUMN email TEXT;
      ALTER TABLE tenant ADD COLUMN website TEXT;
      ALTER TABLE tenant ADD COLUMN country TEXT;
      ALTER TABLE tenant ADD COLUMN county_state TEXT;
      ALTER TABLE tenant ADD COLUMN city_town TEXT;
      ALTER TABLE tenant ADD COLUMN physical_address TEXT;
      ALTER TABLE tenant ADD COLUMN business_type TEXT NOT NULL DEFAULT 'other';
      ALTER TABLE tenant ADD COLUMN owner_name TEXT;
      ALTER TABLE tenant ADD COLUMN owner_phone TEXT;
      ALTER TABLE tenant ADD COLUMN owner_email TEXT;
      ALTER TABLE tenant ADD COLUMN receipt_header TEXT;
      ALTER TABLE tenant ADD COLUMN receipt_footer TEXT;

      ALTER TABLE tenant ADD COLUMN license_key TEXT;
      ALTER TABLE tenant ADD COLUMN license_status TEXT NOT NULL DEFAULT 'trial';
      ALTER TABLE tenant ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'free';
      ALTER TABLE tenant ADD COLUMN subscription_start_date TEXT;
      ALTER TABLE tenant ADD COLUMN subscription_expiry_date TEXT;
      ALTER TABLE tenant ADD COLUMN max_branches INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE tenant ADD COLUMN max_users INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE tenant ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE tenant ADD COLUMN developer_notes TEXT;
      ALTER TABLE tenant ADD COLUMN is_demo_account INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE tenant ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE tenant ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE tenant ADD COLUMN last_synced_at TEXT;
    `
  },
  {
    version: 3,
    name: "storefront_locations",
    sql: `
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        location_code TEXT NOT NULL,
        location_name TEXT NOT NULL,
        display_name TEXT,
        location_type TEXT NOT NULL,
        phone TEXT,
        alternative_phone TEXT,
        email TEXT,
        country TEXT,
        county TEXT,
        city TEXT,
        physical_address TEXT,
        building_name TEXT,
        floor_room TEXT,
        postal_address TEXT,
        latitude REAL,
        longitude REAL,
        google_maps_link TEXT,
        manager_name TEXT,
        manager_phone TEXT,
        manager_email TEXT,
        opening_time TEXT,
        closing_time TEXT,
        working_days TEXT,
        default_tax_rate REAL,
        allow_negative_stock INTEGER NOT NULL DEFAULT 0,
        price_level TEXT,
        is_inventory_location INTEGER NOT NULL DEFAULT 1,
        can_receive_stock INTEGER NOT NULL DEFAULT 1,
        can_sell_stock INTEGER NOT NULL DEFAULT 1,
        can_transfer_stock INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        description TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (tenant_id, location_code),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id)
      );

      CREATE INDEX IF NOT EXISTS idx_locations_tenant_status ON locations(tenant_id, status);
    `
  },
  {
    version: 4,
    name: "product_categories",
    sql: `
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT NOT NULL DEFAULT '#2b5fd9',
        level INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (parent_id) REFERENCES categories(id)
      );

      CREATE INDEX IF NOT EXISTS idx_categories_tenant_parent ON categories(tenant_id, parent_id);
      CREATE INDEX IF NOT EXISTS idx_categories_tenant_level ON categories(tenant_id, level);
    `
  },
  {
    version: 5,
    name: "product_catalog_and_inventory",
    sql: `
      DROP TABLE IF EXISTS products;

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        barcode TEXT,
        qr_code TEXT,
        supplier_sku TEXT,
        name TEXT NOT NULL,
        short_name TEXT,
        description TEXT,
        category_id TEXT,
        buying_price_cents INTEGER NOT NULL DEFAULT 0,
        selling_price_cents INTEGER NOT NULL DEFAULT 0,
        wholesale_price_cents INTEGER,
        minimum_price_cents INTEGER,
        tax_rate REAL NOT NULL DEFAULT 0,
        reorder_level INTEGER NOT NULL DEFAULT 0,
        track_stock INTEGER NOT NULL DEFAULT 1,
        allow_negative_stock INTEGER NOT NULL DEFAULT 0,
        image_path TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (tenant_id, sku),
        UNIQUE (tenant_id, name),
        UNIQUE (tenant_id, barcode),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (category_id) REFERENCES categories(id)
      );

      CREATE INDEX idx_products_tenant_status ON products(tenant_id, status);
      CREATE INDEX idx_products_tenant_category ON products(tenant_id, category_id);

      CREATE TABLE IF NOT EXISTS inventory (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        reserved_quantity INTEGER NOT NULL DEFAULT 0,
        available_quantity INTEGER GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (product_id, location_id),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (location_id) REFERENCES locations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_tenant_location ON inventory(tenant_id, location_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);

      CREATE TABLE IF NOT EXISTS stock_movements (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        movement_type TEXT NOT NULL CHECK (movement_type IN (
          'purchase', 'sale', 'transfer_in', 'transfer_out', 'return', 'damage', 'adjustment', 'opening_stock'
        )),
        quantity_change INTEGER NOT NULL,
        reference_type TEXT,
        reference_id TEXT,
        performed_by TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (location_id) REFERENCES locations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_stock_movements_product_location ON stock_movements(product_id, location_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_created ON stock_movements(tenant_id, created_at);
    `
  },
  {
    version: 6,
    name: "product_wholesale_min_quantity",
    sql: `
      ALTER TABLE products DROP COLUMN qr_code;
      ALTER TABLE products ADD COLUMN wholesale_min_quantity INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 7,
    name: "roles",
    sql: `
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        role_name TEXT NOT NULL,
        description TEXT,
        permissions_json TEXT NOT NULL DEFAULT '{}',
        is_system_role INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (tenant_id, role_name),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id)
      );

      CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
    `
  },
  {
    version: 8,
    name: "employees",
    sql: `
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        employee_code TEXT NOT NULL,
        first_name TEXT NOT NULL,
        middle_name TEXT,
        last_name TEXT NOT NULL,
        gender TEXT,
        date_of_birth TEXT,
        phone TEXT,
        alternative_phone TEXT,
        email TEXT,
        branch_id TEXT,
        department TEXT,
        job_title TEXT,
        hire_date TEXT,
        role_id TEXT,
        pin_hash TEXT,
        username TEXT,
        password_hash TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_login TEXT,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (tenant_id, employee_code),
        UNIQUE (tenant_id, username),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (role_id) REFERENCES roles(id),
        FOREIGN KEY (branch_id) REFERENCES locations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_employees_tenant_status ON employees(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_employees_tenant_role ON employees(tenant_id, role_id);
      CREATE INDEX IF NOT EXISTS idx_employees_tenant_branch ON employees(tenant_id, branch_id);
    `
  },
  {
    version: 9,
    name: "audit_trail_columns",
    sql: `
      ALTER TABLE products ADD COLUMN created_by TEXT;
      ALTER TABLE products ADD COLUMN updated_by TEXT;
      ALTER TABLE roles ADD COLUMN created_by TEXT;
      ALTER TABLE roles ADD COLUMN updated_by TEXT;
    `
  },
  {
    version: 10,
    name: "employee_photo",
    sql: `
      ALTER TABLE employees ADD COLUMN photo_path TEXT;
    `
  },
  {
    version: 11,
    name: "payment_methods",
    sql: `
      CREATE TABLE IF NOT EXISTS payment_methods (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        description TEXT,
        is_system_method INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        requires_reference INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (tenant_id, code),
        UNIQUE (tenant_id, name),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id)
      );

      CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant_active ON payment_methods(tenant_id, is_active);
    `
  },
  {
    version: 12,
    name: "customers",
    sql: `
      DROP TABLE IF EXISTS customers;

      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        customer_code TEXT NOT NULL,
        customer_type TEXT NOT NULL DEFAULT 'retail',
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        physical_address TEXT,
        credit_limit_cents INTEGER,
        current_balance_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (tenant_id, customer_code),
        UNIQUE (tenant_id, phone),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id)
      );

      CREATE INDEX idx_customers_tenant_status ON customers(tenant_id, status);
      CREATE INDEX idx_customers_tenant_phone ON customers(tenant_id, phone);
    `
  },
  {
    version: 13,
    name: "pos_sales",
    sql: `
      DROP TABLE IF EXISTS sale_items;
      DROP TABLE IF EXISTS sales;

      CREATE TABLE sales (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        receipt_number TEXT,
        location_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        customer_id TEXT,
        sale_status TEXT NOT NULL DEFAULT 'pending' CHECK (sale_status IN ('pending', 'completed', 'cancelled')),
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        tax_amount_cents INTEGER NOT NULL DEFAULT 0,
        grand_total_cents INTEGER NOT NULL DEFAULT 0,
        payment_method_id TEXT,
        payment_reference TEXT,
        amount_received_cents INTEGER,
        change_given_cents INTEGER,
        notes TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        UNIQUE (tenant_id, receipt_number),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (location_id) REFERENCES locations(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
      );

      CREATE INDEX idx_sales_tenant_status ON sales(tenant_id, sale_status);
      CREATE INDEX idx_sales_tenant_created ON sales(tenant_id, created_at);
      CREATE INDEX idx_sales_location ON sales(location_id);
      CREATE INDEX idx_sales_customer ON sales(customer_id);

      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        tax_amount_cents INTEGER NOT NULL DEFAULT 0,
        line_total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
      CREATE INDEX idx_sale_items_product ON sale_items(product_id);
    `
  },
  {
    version: 14,
    name: "sale_returns_and_voids",
    sql: `
      CREATE TABLE IF NOT EXISTS sale_voids (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected')),
        reason TEXT NOT NULL,
        notes TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (requested_by) REFERENCES employees(id),
        FOREIGN KEY (approved_by) REFERENCES employees(id)
      );

      CREATE INDEX idx_sale_voids_tenant_status ON sale_voids(tenant_id, status);
      CREATE INDEX idx_sale_voids_sale ON sale_voids(sale_id);

      CREATE TABLE IF NOT EXISTS sale_returns (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected')),
        reason TEXT NOT NULL,
        notes TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (requested_by) REFERENCES employees(id),
        FOREIGN KEY (approved_by) REFERENCES employees(id)
      );

      CREATE INDEX idx_sale_returns_tenant_status ON sale_returns(tenant_id, status);
      CREATE INDEX idx_sale_returns_sale ON sale_returns(sale_id);

      CREATE TABLE IF NOT EXISTS sale_return_items (
        id TEXT PRIMARY KEY,
        sale_return_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        line_total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sale_return_id) REFERENCES sale_returns(id),
        FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE INDEX idx_sale_return_items_return ON sale_return_items(sale_return_id);
    `
  },
  {
    version: 15,
    name: "invoices",
    sql: `
      ALTER TABLE sales ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'retail_sale' CHECK (transaction_type IN ('retail_sale', 'wholesale_sale', 'invoice', 'return', 'exchange'));
      ALTER TABLE sales ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled'));
      ALTER TABLE sales ADD COLUMN invoice_number TEXT;
      ALTER TABLE sales ADD COLUMN invoice_date TEXT;
      ALTER TABLE sales ADD COLUMN due_date TEXT;
      ALTER TABLE sales ADD COLUMN amount_paid_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sales ADD COLUMN balance_due_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sales ADD COLUMN invoice_notes TEXT;
      ALTER TABLE sales ADD COLUMN payments TEXT NOT NULL DEFAULT '[]';

      UPDATE sales SET amount_paid_cents = grand_total_cents, balance_due_cents = 0 WHERE sale_status = 'completed';

      CREATE UNIQUE INDEX idx_sales_tenant_invoice_number ON sales(tenant_id, invoice_number);
      CREATE INDEX idx_sales_transaction_type ON sales(tenant_id, transaction_type);
      CREATE INDEX idx_sales_payment_status ON sales(tenant_id, payment_status);
    `
  },
  {
    version: 16,
    name: "managed_logos",
    sql: `
      ALTER TABLE tenant ADD COLUMN business_logo_ratio TEXT CHECK (business_logo_ratio IN ('landscape', 'portrait', 'square'));
      ALTER TABLE locations ADD COLUMN logo_path TEXT;
      ALTER TABLE locations ADD COLUMN logo_ratio TEXT CHECK (logo_ratio IN ('landscape', 'portrait', 'square'));
    `
  },
  {
    version: 17,
    name: "customer_branch_scoping",
    sql: `
      ALTER TABLE customers ADD COLUMN location_id TEXT REFERENCES locations(id);
      CREATE INDEX idx_customers_location ON customers(location_id);
    `
  },
  {
    version: 18,
    name: "quotations",
    sql: `
      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        quotation_number TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        tax_amount_cents INTEGER NOT NULL DEFAULT 0,
        grand_total_cents INTEGER NOT NULL DEFAULT 0,
        valid_until TEXT NOT NULL,
        notes TEXT,
        converted_sale_id TEXT,
        converted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (location_id) REFERENCES locations(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        FOREIGN KEY (converted_sale_id) REFERENCES sales(id)
      );

      CREATE UNIQUE INDEX idx_quotations_tenant_number ON quotations(tenant_id, quotation_number);
      CREATE INDEX idx_quotations_tenant_status ON quotations(tenant_id, status);
      CREATE INDEX idx_quotations_location ON quotations(location_id);
      CREATE INDEX idx_quotations_customer ON quotations(customer_id);

      CREATE TABLE IF NOT EXISTS quotation_items (
        id TEXT PRIMARY KEY,
        quotation_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        tax_amount_cents INTEGER NOT NULL DEFAULT 0,
        line_total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (quotation_id) REFERENCES quotations(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE INDEX idx_quotation_items_quotation ON quotation_items(quotation_id);
    `
  },
  {
    version: 19,
    name: "product_storefront_tag",
    sql: `
      ALTER TABLE products ADD COLUMN storefront_id TEXT REFERENCES locations(id);
      CREATE INDEX idx_products_storefront ON products(storefront_id);
    `
  },
  {
    version: 20,
    name: "main_store_allocations",
    sql: `
      CREATE TABLE IF NOT EXISTS main_store_allocations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        storefront_id TEXT,
        quantity INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (storefront_id) REFERENCES locations(id)
      );

      CREATE INDEX idx_main_store_allocations_product ON main_store_allocations(product_id);
      CREATE INDEX idx_main_store_allocations_storefront ON main_store_allocations(storefront_id);
      CREATE UNIQUE INDEX idx_main_store_allocations_unique_storefront
        ON main_store_allocations(product_id, storefront_id) WHERE storefront_id IS NOT NULL;
    `
  },
  {
    version: 21,
    name: "suppliers",
    sql: `
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        supplier_code TEXT NOT NULL,
        business_name TEXT NOT NULL,
        contact_person TEXT,
        phone_1 TEXT NOT NULL,
        phone_2 TEXT,
        email TEXT,
        website TEXT,
        country TEXT,
        county TEXT,
        town TEXT,
        physical_address TEXT,
        payment_option TEXT NOT NULL DEFAULT 'cash' CHECK (payment_option IN ('cash', 'mpesa', 'bank_transfer', 'other')),
        mpesa_name TEXT,
        mpesa_number TEXT,
        mpesa_alternative_number TEXT,
        bank_name TEXT,
        bank_account_name TEXT,
        bank_account_number TEXT,
        credit_limit_cents INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id)
      );

      CREATE UNIQUE INDEX idx_suppliers_tenant_code ON suppliers(tenant_id, supplier_code);
      CREATE UNIQUE INDEX idx_suppliers_tenant_business_name ON suppliers(tenant_id, business_name COLLATE NOCASE);
      CREATE INDEX idx_suppliers_tenant_status ON suppliers(tenant_id, status);
    `
  },
  {
    version: 22,
    name: "purchases",
    sql: `
      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        purchase_number TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        supplier_invoice_number TEXT,
        location_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
        tax_type TEXT NOT NULL DEFAULT 'no_vat' CHECK (tax_type IN ('vat', 'no_vat', 'zero_rated')),
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        tax_amount_cents INTEGER NOT NULL DEFAULT 0,
        grand_total_cents INTEGER NOT NULL DEFAULT 0,
        payment_method_id TEXT,
        payment_reference TEXT,
        payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid')),
        amount_paid_cents INTEGER NOT NULL DEFAULT 0,
        payments TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        attachment_path TEXT,
        ordered_at TEXT,
        received_at TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY (location_id) REFERENCES locations(id),
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
        FOREIGN KEY (created_by) REFERENCES employees(id)
      );

      CREATE UNIQUE INDEX idx_purchases_tenant_number ON purchases(tenant_id, purchase_number);
      CREATE UNIQUE INDEX idx_purchases_tenant_supplier_invoice_number
        ON purchases(tenant_id, supplier_id, supplier_invoice_number) WHERE supplier_invoice_number IS NOT NULL;
      CREATE INDEX idx_purchases_tenant_status ON purchases(tenant_id, status);
      CREATE INDEX idx_purchases_tenant_created ON purchases(tenant_id, created_at);
      CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
      CREATE INDEX idx_purchases_location ON purchases(location_id);

      CREATE TABLE IF NOT EXISTS purchase_items (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        ordered_quantity INTEGER NOT NULL,
        received_quantity INTEGER NOT NULL DEFAULT 0,
        remaining_quantity INTEGER GENERATED ALWAYS AS (ordered_quantity - received_quantity) STORED,
        unit_cost_cents INTEGER NOT NULL,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        tax_amount_cents INTEGER NOT NULL DEFAULT 0,
        line_total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
      CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);
    `
  },
  {
    version: 23,
    name: "expenses",
    sql: `
      CREATE TABLE IF NOT EXISTS expense_categories (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id)
      );

      CREATE UNIQUE INDEX idx_expense_categories_tenant_name ON expense_categories(tenant_id, name COLLATE NOCASE);
      CREATE INDEX idx_expense_categories_tenant_status ON expense_categories(tenant_id, status);

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        expense_number TEXT NOT NULL,
        expense_date TEXT NOT NULL,
        category_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        paid_by TEXT,
        payment_method_id TEXT NOT NULL,
        storefront_id TEXT,
        reference TEXT,
        description TEXT,
        attachment_path TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        is_recurring INTEGER NOT NULL DEFAULT 0,
        recurrence_frequency TEXT,
        next_due_date TEXT,
        last_reminder_sent TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (category_id) REFERENCES expense_categories(id),
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
        FOREIGN KEY (storefront_id) REFERENCES locations(id),
        FOREIGN KEY (created_by) REFERENCES employees(id)
      );

      CREATE UNIQUE INDEX idx_expenses_tenant_number ON expenses(tenant_id, expense_number);
      CREATE INDEX idx_expenses_tenant_date ON expenses(tenant_id, expense_date);
      CREATE INDEX idx_expenses_tenant_status ON expenses(tenant_id, status);
      CREATE INDEX idx_expenses_category ON expenses(category_id);
      CREATE INDEX idx_expenses_storefront ON expenses(storefront_id);
    `
  },
  {
    version: 24,
    name: "employee_salaries",
    sql: `
      CREATE TABLE IF NOT EXISTS salaries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        payslip_number TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        pay_period TEXT NOT NULL,
        basic_salary_cents INTEGER NOT NULL,
        allowances_cents INTEGER NOT NULL DEFAULT 0,
        deductions_cents INTEGER NOT NULL DEFAULT 0,
        net_pay_cents INTEGER NOT NULL,
        payment_method_id TEXT NOT NULL,
        payment_reference TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
        FOREIGN KEY (created_by) REFERENCES employees(id)
      );

      CREATE UNIQUE INDEX idx_salaries_tenant_payslip_number ON salaries(tenant_id, payslip_number);
      CREATE UNIQUE INDEX idx_salaries_tenant_employee_period
        ON salaries(tenant_id, employee_id, pay_period) WHERE status = 'active';
      CREATE INDEX idx_salaries_tenant_employee ON salaries(tenant_id, employee_id);
      CREATE INDEX idx_salaries_tenant_status ON salaries(tenant_id, status);
      CREATE INDEX idx_salaries_tenant_created ON salaries(tenant_id, created_at);
    `
  },
  {
    version: 25,
    name: "salary_itemized_allowances_deductions",
    sql: `
      ALTER TABLE salaries ADD COLUMN allowances_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE salaries ADD COLUMN deductions_json TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    version: 26,
    name: "backfill_retail_sale_amount_paid",
    sql: `
      UPDATE sales
      SET amount_paid_cents = grand_total_cents, balance_due_cents = 0
      WHERE sale_status = 'completed' AND payment_status = 'paid' AND amount_paid_cents != grand_total_cents;
    `
  },
  {
    version: 27,
    name: "riders_service_charges_delivery_notes",
    sql: `
      CREATE TABLE riders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        alt_phone TEXT,
        company TEXT,
        vehicle_description TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id)
      );
      CREATE INDEX idx_riders_tenant_status ON riders(tenant_id, status);

      CREATE TABLE sale_service_charges (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT,
        quotation_id TEXT,
        name TEXT NOT NULL,
        fee_cents INTEGER NOT NULL,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        CHECK ((sale_id IS NOT NULL AND quotation_id IS NULL) OR (sale_id IS NULL AND quotation_id IS NOT NULL)),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (quotation_id) REFERENCES quotations(id)
      );
      CREATE INDEX idx_service_charges_sale ON sale_service_charges(sale_id);
      CREATE INDEX idx_service_charges_quotation ON sale_service_charges(quotation_id);

      CREATE TABLE delivery_notes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        delivery_note_number TEXT NOT NULL,
        sale_id TEXT,
        quotation_id TEXT,
        rider_id TEXT,
        recipient_name TEXT NOT NULL,
        country TEXT,
        town TEXT,
        physical_address TEXT NOT NULL,
        notes TEXT,
        fee_cents INTEGER NOT NULL,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        is_delivered INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        CHECK ((sale_id IS NOT NULL AND quotation_id IS NULL) OR (sale_id IS NULL AND quotation_id IS NOT NULL)),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (quotation_id) REFERENCES quotations(id),
        FOREIGN KEY (rider_id) REFERENCES riders(id)
      );
      CREATE UNIQUE INDEX idx_delivery_notes_sale ON delivery_notes(sale_id) WHERE sale_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_delivery_notes_quotation ON delivery_notes(quotation_id) WHERE quotation_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_delivery_notes_tenant_number ON delivery_notes(tenant_id, delivery_note_number);
    `
  },
  {
    version: 28,
    name: "stock_requests",
    sql: `
      CREATE TABLE stock_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        request_number TEXT NOT NULL,
        storefront_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        notes TEXT,
        rejection_reason TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (storefront_id) REFERENCES locations(id),
        FOREIGN KEY (requested_by) REFERENCES employees(id),
        FOREIGN KEY (reviewed_by) REFERENCES employees(id)
      );
      CREATE INDEX idx_stock_requests_tenant_status ON stock_requests(tenant_id, status);
      CREATE INDEX idx_stock_requests_storefront ON stock_requests(storefront_id);
      CREATE UNIQUE INDEX idx_stock_requests_tenant_number ON stock_requests(tenant_id, request_number);

      CREATE TABLE stock_request_items (
        id TEXT PRIMARY KEY,
        stock_request_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity_requested INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (stock_request_id) REFERENCES stock_requests(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX idx_stock_request_items_request ON stock_request_items(stock_request_id);
    `
  },
  {
    version: 29,
    name: "salary_draft_status",
    sql: `
      CREATE TABLE salaries_new (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        payslip_number TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        pay_period TEXT NOT NULL,
        basic_salary_cents INTEGER NOT NULL DEFAULT 0,
        allowances_cents INTEGER NOT NULL DEFAULT 0,
        deductions_cents INTEGER NOT NULL DEFAULT 0,
        net_pay_cents INTEGER NOT NULL DEFAULT 0,
        payment_method_id TEXT,
        payment_reference TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'voided')),
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        allowances_json TEXT NOT NULL DEFAULT '[]',
        deductions_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
        FOREIGN KEY (created_by) REFERENCES employees(id)
      );

      INSERT INTO salaries_new (
        id, tenant_id, payslip_number, employee_id, pay_period, basic_salary_cents, allowances_cents,
        deductions_cents, net_pay_cents, payment_method_id, payment_reference, status, notes,
        created_by, created_at, updated_at, sync_status, last_synced_at, allowances_json, deductions_json
      )
      SELECT
        id, tenant_id, payslip_number, employee_id, pay_period, basic_salary_cents, allowances_cents,
        deductions_cents, net_pay_cents, payment_method_id, payment_reference, status, notes,
        created_by, created_at, updated_at, sync_status, last_synced_at, allowances_json, deductions_json
      FROM salaries;

      DROP TABLE salaries;
      ALTER TABLE salaries_new RENAME TO salaries;

      CREATE UNIQUE INDEX idx_salaries_tenant_payslip_number ON salaries(tenant_id, payslip_number);
      CREATE UNIQUE INDEX idx_salaries_tenant_employee_period
        ON salaries(tenant_id, employee_id, pay_period) WHERE status = 'active';
      CREATE INDEX idx_salaries_tenant_employee ON salaries(tenant_id, employee_id);
      CREATE INDEX idx_salaries_tenant_status ON salaries(tenant_id, status);
      CREATE INDEX idx_salaries_tenant_created ON salaries(tenant_id, created_at);
    `
  },
  {
    version: 30,
    name: "recurring_bills",
    sql: `
      CREATE TABLE recurring_bills (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category_id TEXT,
        storefront_id TEXT,
        amount_cents INTEGER NOT NULL,
        cycle TEXT NOT NULL CHECK (cycle IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
        start_date TEXT NOT NULL,
        next_due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (category_id) REFERENCES expense_categories(id),
        FOREIGN KEY (storefront_id) REFERENCES locations(id),
        FOREIGN KEY (created_by) REFERENCES employees(id)
      );
      CREATE INDEX idx_recurring_bills_tenant_status ON recurring_bills(tenant_id, status);
      CREATE INDEX idx_recurring_bills_next_due ON recurring_bills(tenant_id, next_due_date);
    `
  },
  {
    version: 31,
    name: "location_receipt_branding",
    sql: `
      ALTER TABLE locations ADD COLUMN receipt_header TEXT;
      ALTER TABLE locations ADD COLUMN receipt_footer TEXT;
    `
  },
  {
    version: 32,
    name: "cloud_activation",
    sql: `
      ALTER TABLE tenant ADD COLUMN next_due_date TEXT;
      ALTER TABLE tenant ADD COLUMN last_license_check_at TEXT;

      ALTER TABLE workstations ADD COLUMN device_type TEXT NOT NULL DEFAULT 'desktop';
      ALTER TABLE workstations ADD COLUMN os_name TEXT;
      ALTER TABLE workstations ADD COLUMN app_version TEXT;
    `
  },
  {
    version: 33,
    name: "subscription_type",
    sql: `
      ALTER TABLE tenant ADD COLUMN subscription_type TEXT;
    `
  },
  {
    version: 34,
    name: "cloud_sync_outbox_triggers_phase1",
    sql: `
      -- Populates the (previously unused) sync_outbox table automatically on every write to a
      -- Phase-1 synced table — no application code needs to remember to enqueue anything. Each
      -- trigger only writes a lightweight breadcrumb (which row, which operation); the actual
      -- payload is built fresh at push time by re-reading the row through its own existing
      -- mapXRow() function (see sync-engine.ts), so multiple edits between sync cycles naturally
      -- coalesce into one push of current state rather than replaying every intermediate edit.
      -- idempotency_key mixes in a random suffix (not just id:updated_at) so two edits to the same
      -- row within the same millisecond can never collide against the column's UNIQUE constraint.

      CREATE TRIGGER trg_categories_sync_ai AFTER INSERT ON categories BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'categories', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_categories_sync_au AFTER UPDATE ON categories BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'categories', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_categories_sync_ad AFTER DELETE ON categories BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'categories', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_payment_methods_sync_ai AFTER INSERT ON payment_methods BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'payment_methods', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_payment_methods_sync_au AFTER UPDATE ON payment_methods BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'payment_methods', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_payment_methods_sync_ad AFTER DELETE ON payment_methods BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'payment_methods', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_riders_sync_ai AFTER INSERT ON riders BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'riders', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_riders_sync_au AFTER UPDATE ON riders BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'riders', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_riders_sync_ad AFTER DELETE ON riders BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'riders', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_suppliers_sync_ai AFTER INSERT ON suppliers BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'suppliers', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_suppliers_sync_au AFTER UPDATE ON suppliers BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'suppliers', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_suppliers_sync_ad AFTER DELETE ON suppliers BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'suppliers', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_customers_sync_ai AFTER INSERT ON customers BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'customers', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_customers_sync_au AFTER UPDATE ON customers BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'customers', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_customers_sync_ad AFTER DELETE ON customers BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'customers', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_employees_sync_ai AFTER INSERT ON employees BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'employees', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_employees_sync_au AFTER UPDATE ON employees BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'employees', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_employees_sync_ad AFTER DELETE ON employees BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'employees', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_roles_sync_ai AFTER INSERT ON roles BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'roles', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_roles_sync_au AFTER UPDATE ON roles BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'roles', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_roles_sync_ad AFTER DELETE ON roles BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'roles', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
    `
  },
  {
    version: 35,
    name: "cloud_sync_fix_update_triggers_and_backfill",
    sql: `
      -- Fixes a real bug found in real use: the v34 AFTER UPDATE triggers fired on EVERY update to
      -- a synced table, including updates that only touch fields that were never even part of the
      -- sync payload — most notably employees.last_login/failed_login_attempts/locked_until, which
      -- get written on every single login attempt (see employee-repository.ts's
      -- recordSuccessfulLoginRow/the failed-attempt tracker). Neither of those queries touches
      -- updated_at, so re-scoping the trigger to WHEN NEW.updated_at != OLD.updated_at means a login
      -- no longer re-queues that employee for no reason. Every other table's own UPDATE statements
      -- already bump updated_at whenever a synced field genuinely changes, so this WHEN clause is
      -- purely a safety net for them, not a behavior change.
      DROP TRIGGER trg_categories_sync_au;
      CREATE TRIGGER trg_categories_sync_au AFTER UPDATE ON categories WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'categories', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      DROP TRIGGER trg_payment_methods_sync_au;
      CREATE TRIGGER trg_payment_methods_sync_au AFTER UPDATE ON payment_methods WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'payment_methods', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      DROP TRIGGER trg_riders_sync_au;
      CREATE TRIGGER trg_riders_sync_au AFTER UPDATE ON riders WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'riders', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      DROP TRIGGER trg_suppliers_sync_au;
      CREATE TRIGGER trg_suppliers_sync_au AFTER UPDATE ON suppliers WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'suppliers', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      DROP TRIGGER trg_customers_sync_au;
      CREATE TRIGGER trg_customers_sync_au AFTER UPDATE ON customers WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'customers', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      DROP TRIGGER trg_employees_sync_au;
      CREATE TRIGGER trg_employees_sync_au AFTER UPDATE ON employees WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'employees', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      DROP TRIGGER trg_roles_sync_au;
      CREATE TRIGGER trg_roles_sync_au AFTER UPDATE ON roles WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'roles', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      -- One-time backfill: any Phase-1 row that existed BEFORE migration v34 installed the triggers
      -- above never got enqueued at all (a trigger only fires on a write that happens after it
      -- exists). Without this, every tenant's pre-existing categories/riders/suppliers/etc. would
      -- silently never sync until each one happened to be edited again. Safe to run unconditionally
      -- — a fresh install just has empty tables here, and re-enqueuing an already-synced row is
      -- harmless (push is an idempotent upsert).
      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = categories.tenant_id), 'categories', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM categories;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = payment_methods.tenant_id), 'payment_methods', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM payment_methods;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = riders.tenant_id), 'riders', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM riders;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = suppliers.tenant_id), 'suppliers', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM suppliers;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = customers.tenant_id), 'customers', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM customers;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = employees.tenant_id), 'employees', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM employees;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = roles.tenant_id), 'roles', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM roles;
    `
  },
  {
    version: 36,
    name: "cloud_sync_phase2_products_conflict_detection",
    sql: `
      -- Phase 2: Products is the one conflict-aware entity — synced_updated_at caches the last
      -- server value this device actually saw (the optimistic-lock baseline sent as
      -- baseUpdatedAt on push, see sync-engine.ts). remote_snapshot_json holds the OTHER half of a
      -- detected conflict (the server's current row), populated only when a push comes back
      -- status: "conflict" — together with the outbox row's own already-stored payload_json (the
      -- rejected local version), one outbox row is the whole conflict record; no new table needed.
      ALTER TABLE products ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE sync_outbox ADD COLUMN remote_snapshot_json TEXT;

      -- Learned from the v35 fix (employees' login-touch bug) — scope every trigger with the
      -- updated_at WHEN clause from the start this time, not just on update.
      CREATE TRIGGER trg_products_sync_ai AFTER INSERT ON products BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'products', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_products_sync_au AFTER UPDATE ON products WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'products', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_products_sync_ad AFTER DELETE ON products BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'products', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      -- One-time backfill, same reasoning as v35's: any product that existed before this
      -- migration installed the triggers above never got enqueued at all.
      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = products.tenant_id), 'products', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM products;
    `
  },
  {
    version: 37,
    name: "cloud_sync_phase3_locations_and_sales",
    sql: `
      -- Locations must sync before anything that references it (employees.branch_id,
      -- products.storefront_id, customers.location_id, sales.location_id, etc. are all already-
      -- opaque strings on those models — they only resolve to something meaningful on a fresh
      -- device once this table itself has synced).
      CREATE TRIGGER trg_locations_sync_ai AFTER INSERT ON locations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'locations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_locations_sync_au AFTER UPDATE ON locations WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'locations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_locations_sync_ad AFTER DELETE ON locations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'locations', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      -- Sales/receipts/invoices — one local table covers all three via transaction_type/
      -- payment_status. Its own header-row triggers, same shape as every prior entity.
      CREATE TRIGGER trg_sales_sync_ai AFTER INSERT ON sales BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sales', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sales_sync_au AFTER UPDATE ON sales WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sales', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sales_sync_ad AFTER DELETE ON sales BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'sales', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      -- sale_items/sale_service_charges/delivery_notes are NOT independent sync units — they ride
      -- along nested inside their parent sale's own payload (see sync-engine.ts's bespoke sales
      -- apply logic). A write to any of them must re-queue the PARENT sale, not enqueue an entry
      -- for itself under an entity name that doesn't exist in SYNC_ENTITIES. No delete triggers
      -- needed on any of these three — deleting a held/draft sale deletes the parent row too (which
      -- already enqueues its own 'delete' op), and none of them are ever deleted independently of
      -- their parent in normal use.
      CREATE TRIGGER trg_sale_items_reenqueue_sale_ai AFTER INSERT ON sale_items BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id;
      END;
      CREATE TRIGGER trg_service_charges_reenqueue_sale_ai AFTER INSERT ON sale_service_charges WHEN NEW.sale_id IS NOT NULL BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id;
      END;
      CREATE TRIGGER trg_delivery_notes_reenqueue_sale_ai AFTER INSERT ON delivery_notes WHEN NEW.sale_id IS NOT NULL BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id;
      END;
      -- The one child-table UPDATE that matters: marking a delivery note delivered doesn't touch
      -- the sale row at all, but delivery status lives inside the sale's own nested payload now —
      -- so this must re-queue the parent sale, or a "mark delivered" click would silently never sync.
      CREATE TRIGGER trg_delivery_notes_reenqueue_sale_au AFTER UPDATE ON delivery_notes WHEN NEW.sale_id IS NOT NULL AND NEW.is_delivered != OLD.is_delivered BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id;
      END;

      -- One-time backfill for the two real sync units (locations, sales) — a sale's backfill entry
      -- naturally picks up its current items/serviceCharges/delivery at push time, since the payload
      -- is always built fresh by re-reading the row's current children, not replayed from history.
      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = locations.tenant_id), 'locations', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM locations;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = sales.tenant_id), 'sales', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM sales;
    `
  },
  {
    version: 38,
    name: "cloud_sync_phase3_followup_documents",
    sql: `
      -- Flat, single-row documents (no line items) — plain Phase 1/2-style triggers, one set per
      -- table. WHEN updated_at changed from the start (v35's lesson).
      CREATE TRIGGER trg_expense_categories_sync_ai AFTER INSERT ON expense_categories BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'expense_categories', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_expense_categories_sync_au AFTER UPDATE ON expense_categories WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'expense_categories', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_expense_categories_sync_ad AFTER DELETE ON expense_categories BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'expense_categories', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_expenses_sync_ai AFTER INSERT ON expenses BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'expenses', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_expenses_sync_au AFTER UPDATE ON expenses WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'expenses', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_expenses_sync_ad AFTER DELETE ON expenses BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'expenses', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_salaries_sync_ai AFTER INSERT ON salaries BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'salaries', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_salaries_sync_au AFTER UPDATE ON salaries WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'salaries', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_salaries_sync_ad AFTER DELETE ON salaries BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'salaries', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_recurring_bills_sync_ai AFTER INSERT ON recurring_bills BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'recurring_bills', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_recurring_bills_sync_au AFTER UPDATE ON recurring_bills WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'recurring_bills', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_recurring_bills_sync_ad AFTER DELETE ON recurring_bills BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'recurring_bills', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_sale_voids_sync_ai AFTER INSERT ON sale_voids BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sale_voids', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sale_voids_sync_au AFTER UPDATE ON sale_voids WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sale_voids', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sale_voids_sync_ad AFTER DELETE ON sale_voids BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'sale_voids', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      -- Documents-with-line-items — same "header triggers + child re-enqueue" pattern as Sales.
      CREATE TRIGGER trg_sale_returns_sync_ai AFTER INSERT ON sale_returns BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sale_returns', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sale_returns_sync_au AFTER UPDATE ON sale_returns WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sale_returns', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sale_returns_sync_ad AFTER DELETE ON sale_returns BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'sale_returns', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sale_return_items_reenqueue_ai AFTER INSERT ON sale_return_items BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), sr.tenant_id, (SELECT client_id FROM tenant WHERE id = sr.tenant_id), 'sale_returns', sr.id, 'upsert', 'push', 'queued', 0, '{}', sr.id || ':' || sr.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sale_returns sr WHERE sr.id = NEW.sale_return_id;
      END;

      CREATE TRIGGER trg_quotations_sync_ai AFTER INSERT ON quotations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'quotations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_quotations_sync_au AFTER UPDATE ON quotations WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'quotations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_quotations_sync_ad AFTER DELETE ON quotations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'quotations', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_quotation_items_reenqueue_ai AFTER INSERT ON quotation_items BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), q.tenant_id, (SELECT client_id FROM tenant WHERE id = q.tenant_id), 'quotations', q.id, 'upsert', 'push', 'queued', 0, '{}', q.id || ':' || q.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM quotations q WHERE q.id = NEW.quotation_id;
      END;
      -- sale_service_charges/delivery_notes already re-enqueue the parent SALE when sale_id is set
      -- (v37) — these are the quotation_id-keyed counterparts, since both tables can attach to
      -- either a sale or a quotation (CHECK constraint enforces exactly one).
      CREATE TRIGGER trg_service_charges_reenqueue_quotation_ai AFTER INSERT ON sale_service_charges WHEN NEW.quotation_id IS NOT NULL BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), q.tenant_id, (SELECT client_id FROM tenant WHERE id = q.tenant_id), 'quotations', q.id, 'upsert', 'push', 'queued', 0, '{}', q.id || ':' || q.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM quotations q WHERE q.id = NEW.quotation_id;
      END;
      CREATE TRIGGER trg_delivery_notes_reenqueue_quotation_ai AFTER INSERT ON delivery_notes WHEN NEW.quotation_id IS NOT NULL BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), q.tenant_id, (SELECT client_id FROM tenant WHERE id = q.tenant_id), 'quotations', q.id, 'upsert', 'push', 'queued', 0, '{}', q.id || ':' || q.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM quotations q WHERE q.id = NEW.quotation_id;
      END;
      CREATE TRIGGER trg_delivery_notes_reenqueue_quotation_au AFTER UPDATE ON delivery_notes WHEN NEW.quotation_id IS NOT NULL AND NEW.is_delivered != OLD.is_delivered BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), q.tenant_id, (SELECT client_id FROM tenant WHERE id = q.tenant_id), 'quotations', q.id, 'upsert', 'push', 'queued', 0, '{}', q.id || ':' || q.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM quotations q WHERE q.id = NEW.quotation_id;
      END;

      CREATE TRIGGER trg_purchases_sync_ai AFTER INSERT ON purchases BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'purchases', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_purchases_sync_au AFTER UPDATE ON purchases WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'purchases', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_purchases_sync_ad AFTER DELETE ON purchases BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'purchases', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_purchase_items_reenqueue_ai AFTER INSERT ON purchase_items BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), p.tenant_id, (SELECT client_id FROM tenant WHERE id = p.tenant_id), 'purchases', p.id, 'upsert', 'push', 'queued', 0, '{}', p.id || ':' || p.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM purchases p WHERE p.id = NEW.purchase_id;
      END;

      -- One-time backfill for the 8 real sync units (their nested children ride along at push time).
      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = expense_categories.tenant_id), 'expense_categories', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM expense_categories;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = expenses.tenant_id), 'expenses', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM expenses;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = salaries.tenant_id), 'salaries', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM salaries;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = recurring_bills.tenant_id), 'recurring_bills', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM recurring_bills;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = sale_voids.tenant_id), 'sale_voids', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM sale_voids;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = sale_returns.tenant_id), 'sale_returns', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM sale_returns;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = quotations.tenant_id), 'quotations', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM quotations;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = purchases.tenant_id), 'purchases', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM purchases;
    `
  },
  {
    version: 39,
    name: "cloud_sync_phase4_stock_movements",
    sql: `
      -- inventory.quantity/main_store_allocations are locally-DERIVED running totals, not
      -- independently-edited values (see applyValidatedStockMovement in inventory-service.ts) — they
      -- are never synced directly. stock_movements IS the source of truth ledger, and it's genuinely
      -- immutable (no update/delete function exists anywhere in the codebase), so it gets an
      -- INSERT-only trigger, no update/delete trigger, and sync-engine.ts applies a pulled movement
      -- as a DELTA to local inventory/allocations rather than an upsert of the movement row itself.
      --
      -- allocation_storefront_id/allocation_explicit persist what applyValidatedStockMovement already
      -- computes at write time but previously threw away: whether the ORIGINAL call explicitly
      -- targeted an allocation bucket (allocation_explicit = 1; NULL bucket id means the unallocated
      -- bucket, targeted precisely) vs never mentioned allocations at all (allocation_explicit = 0,
      -- the fallback "adjust the unallocated bucket, clamped at zero" path every other caller takes).
      -- Without this, a second device replaying the movement can't tell those two cases apart, since
      -- both look identical (a plain quantity_change) without it.
      ALTER TABLE stock_movements ADD COLUMN allocation_storefront_id TEXT;
      ALTER TABLE stock_movements ADD COLUMN allocation_explicit INTEGER NOT NULL DEFAULT 0;

      CREATE TRIGGER trg_stock_movements_sync_ai AFTER INSERT ON stock_movements BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'stock_movements', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.created_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = stock_movements.tenant_id), 'stock_movements', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM stock_movements;
    `
  },
  {
    version: 40,
    name: "cloud_sync_stock_requests",
    sql: `
      -- The last entity in "buy a new device, get everything back" — a plain document-with-line-items
      -- (like Quotations/Purchases/SaleReturns), NOT a ledger like stock_movements: stock_requests has
      -- a real update path (approve/reject bumps status/reviewed_by/reviewed_at/updated_at), and its
      -- items are only ever inserted once at creation, never edited afterward (confirmed — no
      -- update/delete function exists for stock_request_items). Approving a request creates its OWN
      -- stock_movements rows via distributeMainStoreStockCore, which already sync independently — this
      -- entity is purely the approval-workflow record itself, nothing about stock quantities.
      CREATE TRIGGER trg_stock_requests_sync_ai AFTER INSERT ON stock_requests BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'stock_requests', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_stock_requests_sync_au AFTER UPDATE ON stock_requests WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'stock_requests', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_stock_requests_sync_ad AFTER DELETE ON stock_requests BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'stock_requests', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_stock_request_items_reenqueue_ai AFTER INSERT ON stock_request_items BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), sr.tenant_id, (SELECT client_id FROM tenant WHERE id = sr.tenant_id), 'stock_requests', sr.id, 'upsert', 'push', 'queued', 0, '{}', sr.id || ':' || sr.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM stock_requests sr WHERE sr.id = NEW.stock_request_id;
      END;

      INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), tenant_id, (SELECT client_id FROM tenant WHERE id = stock_requests.tenant_id), 'stock_requests', id, 'upsert', 'push', 'queued', 0, '{}', id || ':backfill:' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
      FROM stock_requests;
    `
  },
  {
    version: 41,
    name: "sync_id_aliases",
    sql: `
      -- Backs applyPulledRow's natural-key reconciliation (roles/employees/payment_methods/
      -- expense_categories/locations — every entity seeded locally at boot, see APPLY_CONFIG's own
      -- naturalKey comment). When a second device's locally-seeded default collides by name/code with
      -- the SAME default pushed independently by another device, the LOCAL row's id is kept stable
      -- (never renamed in place — found live via real two-device testing that renaming breaks any
      -- OTHER payload, including that same row's own future re-pulls, still holding the old id). This
      -- table instead remembers "the cloud once called this local row by a different id" so any
      -- foreign-key-shaped field encountered later (in ANY payload) can be resolved to the correct
      -- local id instead of failing to find a row that was never created under that id.
      CREATE TABLE IF NOT EXISTS sync_id_aliases (
        entity TEXT NOT NULL,
        cloud_id TEXT NOT NULL,
        local_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity, cloud_id)
      );
    `
  },
  {
    version: 42,
    name: "workstation_device_sequence",
    sql: `
      -- Written once by a successful activation (see license-service.ts's activateInstallation) —
      -- the permanent, never-reused ordinal the server assigned this device (Device.sequenceNumber).
      -- Null until activation completes; used as the per-device tag baked into every document
      -- number this device generates from then on (see document-number-service.ts), so two offline
      -- devices for the same tenant can never independently mint the same receipt/invoice/etc number.
      ALTER TABLE workstations ADD COLUMN device_sequence INTEGER;
    `
  },
  {
    version: 43,
    name: "conflict_aware_reference_data",
    sql: `
      -- Extends Phase 2's optimistic-lock mechanism (previously Products only) to every other
      -- entity that goes through the generic (non-bespoke) apply path — see sync-engine.ts's
      -- CONFLICT_AWARE_ENTITIES. Identical role to products.synced_updated_at: caches the last
      -- localUpdatedAt value this device saw from the server, sent back as baseUpdatedAt on the
      -- next push so the server can detect "someone else's write landed in between" instead of
      -- silently last-write-wins overwriting it. Documents (sales/quotations/purchases/
      -- sale_returns/stock_requests) and the append-only stock_movements ledger are NOT included
      -- here — they go through bespoke apply functions that don't support this caching yet; that's
      -- a separate, larger follow-up, not a config-only change like this one.
      ALTER TABLE categories ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE payment_methods ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE riders ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE suppliers ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE customers ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE employees ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE roles ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE locations ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE expense_categories ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE expenses ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE salaries ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE recurring_bills ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE sale_voids ADD COLUMN synced_updated_at TEXT;
    `
  },
  {
    version: 44,
    name: "conflict_aware_documents",
    sql: `
      -- The follow-up v43 itself deferred: extends the same optimistic-lock caching to the
      -- document entities (sales/quotations/purchases/sale_returns/stock_requests) — their bespoke
      -- apply functions (upsertDocumentHeader, applySalePulledRow) gained the same conditional
      -- synced_updated_at handling the generic path already had. stock_movements stays out
      -- permanently — an append-only ledger has no concurrent-edit scenario to guard against.
      ALTER TABLE sales ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE quotations ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE purchases ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE sale_returns ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE stock_requests ADD COLUMN synced_updated_at TEXT;
    `
  },
  {
    version: 45,
    name: "requeue_employee_secrets",
    sql: `
      -- One-time re-push trigger for the PIN/password hash sync fix shipped earlier today (see
      -- password-hash.ts / PAYLOAD_BUILDERS.employees) — an employee already marked 'synced' before
      -- that change shipped never re-enqueues on its own (nothing re-queues an already-synced row
      -- without a real edit), so its hash would stay permanently missing on the cloud and on any
      -- other device that pulls it. Self-scoping so it's safe on EVERY device, no "which device is
      -- primary" judgment call needed: a device only flips sync_status back to 'pending' for
      -- employees where IT holds a real (non-null) pin_hash locally. A device that only ever
      -- received a given employee via an already-broken pull (pin_hash pulled as NULL, before this
      -- fix existed) does nothing for that row, so it can't re-push a null hash over the real one
      -- about to arrive from wherever the real data actually lives.
      UPDATE employees SET sync_status = 'pending' WHERE pin_hash IS NOT NULL AND sync_status = 'synced';
    `
  },
  {
    version: 46,
    name: "requeue_employee_secrets_bump_updated_at",
    sql: `
      -- v45 above flipped sync_status back to 'pending' WITHOUT bumping updated_at, to avoid
      -- disturbing real edit history — but that breaks applyPulledRow()'s own pull-side guard
      -- ("local is already same-or-newer, don't overwrite" — see sync-engine.ts), which compares
      -- ONLY updated_at. A device that had already pulled one of these employees before today gets
      -- back the exact same updated_at it already has locally, so the guard's >= comparison treats
      -- it as "nothing new" and silently no-ops forever — confirmed live: a second device's
      -- last_synced_at for these rows stayed frozen days in the past no matter how long it was left
      -- open, because every pull attempt hit this guard and returned immediately. Every OTHER write
      -- path in this codebase always bumps updated_at when a row's synced content changes (every
      -- updateXRow() does); this migration corrects v45's break of that invariant for the same
      -- self-scoped set of rows, so the next push carries a genuinely newer timestamp a pulling
      -- device's guard will accept.
      UPDATE employees SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), sync_status = 'pending'
      WHERE pin_hash IS NOT NULL;
    `
  },
  {
    version: 47,
    name: "tenant_business_profile_updated_at",
    sql: `
      -- Business Profile has always used its OWN separate push/pull path (POST /activation/profile
      -- and the register/heartbeat responses), never the generic entity sync_outbox mechanism — this
      -- column is this device's own local "when did I last actually edit my business profile"
      -- timestamp, used to decide whether an incoming heartbeat's copy is newer before ever
      -- overwriting anything. Deliberately NOT the same as tenant.updated_at, which also bumps for a
      -- dozen unrelated reasons (license/device-sequence writes on every heartbeat) and so can't
      -- tell "the profile actually changed" from "something about this tenant changed".
      ALTER TABLE tenant ADD COLUMN business_profile_updated_at TEXT;
    `
  },
  {
    version: 48,
    name: "main_store_allocations_sync",
    sql: `
      -- main_store_allocations was local-only bookkeeping since its creation (v20) — but a real gap
      -- surfaced live via two-device testing (2026-07-26): reallocateMainStoreStock() (moving stock
      -- between two buckets, e.g. unallocated -> a specific storefront) never wrote a
      -- stock_movements row, so a pulling device had no way to ever learn about it, and its own
      -- attempt to replay OTHER movements against a bucket state that had silently diverged threw
      -- and permanently froze that device's entire stock_movements pull cursor (the cursor only
      -- advances once every row in a page applies — see pullEntity's own comment). Promoting this
      -- table to a directly-synced entity (its OWN push/pull, not something reconstructed by
      -- replaying the ledger) is the correct fix — every other piece of mutable state in this app
      -- already syncs this way; ledger-replay was only ever used here because this table didn't.
      --
      -- bucket_key is a synthetic natural key (product_id || ':' || (storefront_id or
      -- 'unallocated')) so this reuses the EXACT SAME naturalKey/sync_id_aliases reconciliation
      -- every boot-seeded reference entity already has (see APPLY_CONFIG's own comment) — two
      -- devices that each first-touch the SAME real bucket before ever syncing with each other get
      -- merged by bucket_key instead of creating two permanent duplicate rows. Safe to use here even
      -- though allocations aren't boot-seeded: product_id is never aliased, and storefront_id inside
      -- a bucket only ever references a real, user-created storefront (never the boot-seeded Main
      -- Store row itself, which is never a valid allocation target) or is NULL — so the composite
      -- stays stable across devices in practice.
      ALTER TABLE main_store_allocations ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE main_store_allocations ADD COLUMN last_synced_at TEXT;
      ALTER TABLE main_store_allocations ADD COLUMN synced_updated_at TEXT;
      ALTER TABLE main_store_allocations ADD COLUMN bucket_key TEXT;

      UPDATE main_store_allocations SET bucket_key = product_id || ':' || COALESCE(storefront_id, 'unallocated');

      CREATE UNIQUE INDEX idx_main_store_allocations_bucket_key ON main_store_allocations(tenant_id, bucket_key);

      CREATE TRIGGER trg_main_store_allocations_sync_ai AFTER INSERT ON main_store_allocations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'main_store_allocations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_main_store_allocations_sync_au AFTER UPDATE ON main_store_allocations WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'main_store_allocations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      -- No manual backfill INSERT needed here (unlike v39/v40's own backfill) — every existing row
      -- just got sync_status='pending' from the ALTER TABLE's own DEFAULT above, and the standing
      -- enqueueUnsyncedRows() sweep (runs at the start of every push cycle) already picks up any
      -- SYNC_ENTITIES-registered table with unsynced rows automatically.
    `
  },
  {
    version: 49,
    name: "product_unit_of_measure",
    sql: `
      -- Deliberately no DEFAULT — NULL is a real, permanent state for a product (not just a
      -- transitional one to be backfilled), since a lot of existing/imported products never had
      -- a unit tracked at all and there's no safe value to guess on their behalf.
      ALTER TABLE products ADD COLUMN unit_of_measure TEXT;
    `
  },
  {
    version: 50,
    name: "customer_supplier_kra_pin",
    sql: `
      -- Nullable, no default — most existing customers/suppliers were never asked for this, and
      -- there's no safe value to backfill on their behalf.
      ALTER TABLE customers ADD COLUMN kra_pin TEXT;
      ALTER TABLE suppliers ADD COLUMN kra_pin TEXT;
    `
  },
  {
    version: 51,
    name: "held_sales_local_only",
    sql: `
      -- Held ("pending") sales are a local checkout-screen convenience — never meant to leave the
      -- device. Under the old triggers a held sale synced to the cloud like any other row, and since
      -- this sync system has no delete propagation, deleting an already-synced held sale would leave
      -- a stale orphan on the cloud forever — so deletePendingSale simply refused, and held sales
      -- piled up on the checkout screen with no way to clear them. Fix: a sale only ever enqueues to
      -- the outbox once it stops being "pending" (i.e. once it's actually completed) — a held sale's
      -- insert/update/delete while still pending never touches sync_outbox at all, exactly like
      -- printer settings never do. Completing a held sale has always been a fresh INSERT of a brand
      -- new completed row (see insertCompletedSaleFromCart) with the old pending row hard-deleted
      -- alongside it (discardResumedSale) — so gating INSERT on sale_status alone is enough to cover
      -- every real path; the UPDATE trigger only needs the same guard for symmetry/defense.
      DROP TRIGGER trg_sales_sync_ai;
      DROP TRIGGER trg_sales_sync_au;
      DROP TRIGGER trg_sales_sync_ad;
      DROP TRIGGER trg_sale_items_reenqueue_sale_ai;
      DROP TRIGGER trg_service_charges_reenqueue_sale_ai;
      DROP TRIGGER trg_delivery_notes_reenqueue_sale_ai;
      DROP TRIGGER trg_delivery_notes_reenqueue_sale_au;

      CREATE TRIGGER trg_sales_sync_ai AFTER INSERT ON sales WHEN NEW.sale_status != 'pending' BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sales', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sales_sync_au AFTER UPDATE ON sales WHEN NEW.updated_at != OLD.updated_at AND NEW.sale_status != 'pending' BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'sales', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_sales_sync_ad AFTER DELETE ON sales WHEN OLD.sale_status != 'pending' BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'sales', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;

      CREATE TRIGGER trg_sale_items_reenqueue_sale_ai AFTER INSERT ON sale_items BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id AND s.sale_status != 'pending';
      END;
      CREATE TRIGGER trg_service_charges_reenqueue_sale_ai AFTER INSERT ON sale_service_charges WHEN NEW.sale_id IS NOT NULL BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id AND s.sale_status != 'pending';
      END;
      CREATE TRIGGER trg_delivery_notes_reenqueue_sale_ai AFTER INSERT ON delivery_notes WHEN NEW.sale_id IS NOT NULL BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id AND s.sale_status != 'pending';
      END;
      CREATE TRIGGER trg_delivery_notes_reenqueue_sale_au AFTER UPDATE ON delivery_notes WHEN NEW.sale_id IS NOT NULL AND NEW.is_delivered != OLD.is_delivered BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), s.tenant_id, (SELECT client_id FROM tenant WHERE id = s.tenant_id), 'sales', s.id, 'upsert', 'push', 'queued', 0, '{}', s.id || ':' || s.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM sales s WHERE s.id = NEW.sale_id AND s.sale_status != 'pending';
      END;

      -- Undo the damage already done under the old triggers: any held sale sitting in the outbox
      -- right now (queued/failed, never actually reached the cloud yet) should never go out.
      DELETE FROM sync_outbox WHERE entity = 'sales' AND status IN ('queued', 'failed')
        AND entity_id IN (SELECT id FROM sales WHERE sale_status = 'pending');
    `
  },
  {
    version: 52,
    name: "held_sale_delivery_draft",
    sql: `
      -- A held sale's own delivery info (rider/recipient/address/notes) used to be persisted as a
      -- REAL delivery_notes row the moment the cart was merely held — which is exactly what caused
      -- the whole migration-51 mess: resuming/re-holding/completing a held sale discarded that row
      -- and minted a new one, and a freed-up local number could collide with an already-synced
      -- orphan. Fix at the root: a held sale now stashes its delivery as a plain JSON draft on the
      -- sale row itself, with no delivery_note_number allocated until the sale actually completes
      -- (see sale-service.ts's suspendSale/persistCartExtras split).
      ALTER TABLE sales ADD COLUMN delivery_draft_json TEXT;
    `
  },
  {
    version: 53,
    name: "expense_kind_local_purchases",
    sql: `
      -- "Local Purchases" (small day-to-day buys — tape, delivery bags, a pen) reuse the exact same
      -- expenses table/sync machinery as formal expenses, rather than a whole parallel entity —
      -- this one column is the only thing distinguishing them. A brand-new dedicated permission
      -- module ("local_purchases", see shared/types/role.ts) is what actually keeps a cashier from
      -- ever seeing 'general' rows: every local-purchase-service.ts query filters on this column
      -- server-side, it isn't a UI-level hide. Existing rows are all real formal expenses.
      ALTER TABLE expenses ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';
    `
  },
  {
    version: 54,
    name: "tenant_vat_settings",
    sql: `
      -- Every product picks one of exactly three tax categories (see migration 55): 'vat'
      -- (standard-rated), 'exempted', 'zero_rated'. The last two are always 0% by definition; this
      -- is the % applied to 'vat' only, tenant-configurable rather than hardcoded 16 so this app
      -- doesn't need another migration once it reaches a market with a different VAT rate
      -- (Uganda/Tanzania 18%, Ethiopia 15%). pricesTaxInclusive exists for the same forward-looking
      -- reason but only the inclusive (divide) calculation path is actually implemented today.
      ALTER TABLE tenant ADD COLUMN vat_rate_percent REAL NOT NULL DEFAULT 16;
      ALTER TABLE tenant ADD COLUMN prices_tax_inclusive INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    version: 55,
    name: "product_tax_type",
    sql: `
      -- Replaces the flat tax_rate percentage (still present, no longer consulted by new
      -- calculation code) with a real category so Exempted and Zero-Rated — both previously
      -- indistinguishable "tax_rate = 0" — can be reported separately, per KRA's own distinction.
      -- Backfill is a best-effort default, not a guess at legal correctness: existing tax_rate > 0
      -- becomes 'vat' (it WAS being taxed), tax_rate = 0 becomes 'zero_rated' (the more common of
      -- the two zero-tax categories in a general retail catalog) — an admin corrects any product
      -- that was actually meant to be 'exempted'.
      ALTER TABLE products ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'vat'
        CHECK (tax_type IN ('vat', 'exempted', 'zero_rated'));
      UPDATE products SET tax_type = CASE WHEN tax_rate > 0 THEN 'vat' ELSE 'zero_rated' END;
    `
  },
  {
    version: 56,
    name: "line_item_tax_type_snapshot",
    sql: `
      -- What tax category actually applied AT THE TIME of this line — a product's own tax_type can
      -- change later, but a historical sale/quotation/purchase must keep reporting whatever was true
      -- when it happened. Backfill mirrors migration 55's same product-level default, since every
      -- existing line item was priced under the old flat-rate model.
      ALTER TABLE sale_items ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'vat'
        CHECK (tax_type IN ('vat', 'exempted', 'zero_rated'));
      ALTER TABLE quotation_items ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'vat'
        CHECK (tax_type IN ('vat', 'exempted', 'zero_rated'));
      ALTER TABLE purchase_items ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'vat'
        CHECK (tax_type IN ('vat', 'exempted', 'zero_rated'));

      UPDATE sale_items SET tax_type = CASE
        WHEN (SELECT tax_rate FROM products WHERE products.id = sale_items.product_id) > 0 THEN 'vat'
        ELSE 'zero_rated'
      END WHERE product_id IN (SELECT id FROM products);
      UPDATE quotation_items SET tax_type = CASE
        WHEN (SELECT tax_rate FROM products WHERE products.id = quotation_items.product_id) > 0 THEN 'vat'
        ELSE 'zero_rated'
      END WHERE product_id IN (SELECT id FROM products);
      UPDATE purchase_items SET tax_type = CASE
        WHEN (SELECT tax_rate FROM products WHERE products.id = purchase_items.product_id) > 0 THEN 'vat'
        ELSE 'zero_rated'
      END WHERE product_id IN (SELECT id FROM products);
    `
  },
  {
    version: 57,
    name: "locally_sourced_sale_items",
    sql: `
      -- A shop that doesn't stock something a customer wants sometimes buys it from another shop
      -- on the spot, then sells it through as a normal sale line. These three columns are what let
      -- Checkout capture that: the toggle, what was actually paid for it, and who it was bought
      -- from — the sale/receipt itself needs nothing else, it's still a completely ordinary sale.
      ALTER TABLE sale_items ADD COLUMN is_locally_sourced INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sale_items ADD COLUMN local_cost_cents INTEGER;
      ALTER TABLE sale_items ADD COLUMN local_supplier_id TEXT REFERENCES suppliers(id);
    `
  },
  {
    version: 58,
    name: "invoice_quotation_branding",
    sql: `
      -- Invoices/quotations used to just borrow the receipt footer (no header of their own at all) —
      -- these give each document type its own header/footer, same per-storefront-overrides-tenant-
      -- default pattern already used for receipt_header/receipt_footer. The two image toggles are
      -- per-storefront only (no tenant-level default — there's no UI for one, same as the existing
      -- receipt_header/receipt_footer tenant columns, which exist purely as a resolveDocumentBusiness
      -- fallback for the no-location-assigned case, not something actually configured anywhere).
      ALTER TABLE tenant ADD COLUMN invoice_header TEXT;
      ALTER TABLE tenant ADD COLUMN invoice_footer TEXT;
      ALTER TABLE tenant ADD COLUMN quotation_header TEXT;
      ALTER TABLE tenant ADD COLUMN quotation_footer TEXT;

      ALTER TABLE locations ADD COLUMN invoice_header TEXT;
      ALTER TABLE locations ADD COLUMN invoice_footer TEXT;
      ALTER TABLE locations ADD COLUMN quotation_header TEXT;
      ALTER TABLE locations ADD COLUMN quotation_footer TEXT;
      ALTER TABLE locations ADD COLUMN show_product_images_on_invoices INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE locations ADD COLUMN show_product_images_on_quotations INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 59,
    name: "stock_receipts",
    sql: `
      -- Bulk "receive many products in one go" — same header + line-items shape as every other
      -- multi-line document in this app (purchases, stock_requests), not a generic grouping tag on
      -- stock_movements, specifically so a reprint months later shows exactly what was true at the
      -- moment of receiving (previous_quantity/new_quantity are frozen per line, never recomputed).
      -- allocation_storefront_id is only meaningful when location_id is the tenant's Main Store —
      -- same "one bucket for the whole batch" simplification the single-item Receive tab already
      -- makes, just applied at the header instead of per item.
      CREATE TABLE stock_receipts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        receipt_number TEXT NOT NULL,
        location_id TEXT NOT NULL,
        allocation_storefront_id TEXT,
        received_by TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        synced_updated_at TEXT,
        UNIQUE (tenant_id, receipt_number),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (location_id) REFERENCES locations(id),
        FOREIGN KEY (allocation_storefront_id) REFERENCES locations(id),
        FOREIGN KEY (received_by) REFERENCES employees(id)
      );

      CREATE INDEX idx_stock_receipts_tenant_created ON stock_receipts(tenant_id, created_at);
      CREATE INDEX idx_stock_receipts_location ON stock_receipts(location_id);

      CREATE TABLE stock_receipt_items (
        id TEXT PRIMARY KEY,
        stock_receipt_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity_received INTEGER NOT NULL,
        previous_quantity INTEGER NOT NULL,
        new_quantity INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (stock_receipt_id) REFERENCES stock_receipts(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE INDEX idx_stock_receipt_items_receipt ON stock_receipt_items(stock_receipt_id);
      CREATE INDEX idx_stock_receipt_items_product ON stock_receipt_items(product_id);

      -- Same sync-outbox trigger shape as stock_requests (a brand-new table, so these ride the
      -- create migration itself instead of a separate later one). No AFTER UPDATE trigger: a stock
      -- receipt is create-only by design ("frozen at moment of receiving" — no edit/approve flow
      -- exists), so updated_at never changes after insert. AFTER DELETE is included defensively even
      -- though no delete function exists today, matching every other document entity's own trigger set.
      CREATE TRIGGER trg_stock_receipts_sync_ai AFTER INSERT ON stock_receipts BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'stock_receipts', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_stock_receipts_sync_ad AFTER DELETE ON stock_receipts BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'stock_receipts', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_stock_receipt_items_reenqueue_ai AFTER INSERT ON stock_receipt_items BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), sr.tenant_id, (SELECT client_id FROM tenant WHERE id = sr.tenant_id), 'stock_receipts', sr.id, 'upsert', 'push', 'queued', 0, '{}', sr.id || ':' || sr.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now')
        FROM stock_receipts sr WHERE sr.id = NEW.stock_receipt_id;
      END;
    `
  },
  {
    version: 60,
    name: "employee_default_compensation",
    sql: `
      -- Lets an employee's usual pay be saved once and reused every time a salary is processed for
      -- them, instead of re-typing it each pay period. Purely a starting point for the Process
      -- Salary form (SalaryFormModal) — never read anywhere else, and editing/removing a line there
      -- only affects that one salary's own allowances_json/deductions_json, never these defaults.
      -- default_basic_salary_cents is nullable (an employee with no saved default just gets a blank
      -- field, same as today); the JSON columns default to '[]' so every existing employee row gets
      -- a valid, parseable value without a separate backfill step.
      ALTER TABLE employees ADD COLUMN default_basic_salary_cents INTEGER;
      ALTER TABLE employees ADD COLUMN default_allowances_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE employees ADD COLUMN default_deductions_json TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    version: 61,
    name: "locally_sourced_quotation_items",
    sql: `
      -- Same feature as locally_sourced_sale_items (migration 57), extended to quotations — a
      -- quoted product this shop doesn't stock is just as likely to have been sourced from another
      -- shop as one already sold. Quotations use their own quotation_items table (not sale_items),
      -- so this needed its own migration rather than being covered by 57.
      ALTER TABLE quotation_items ADD COLUMN is_locally_sourced INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE quotation_items ADD COLUMN local_cost_cents INTEGER;
      ALTER TABLE quotation_items ADD COLUMN local_supplier_id TEXT REFERENCES suppliers(id);
    `
  },
  {
    version: 62,
    name: "sync_pull_orphans",
    sql: `
      -- Diagnostic-only quarantine for pull rows whose NOT NULL foreign key (e.g. stock_movements.
      -- location_id) genuinely never resolves — not a race where the dependency just hasn't arrived
      -- yet (that already self-heals via pullEntity's normal same-page retry), but a permanent gap,
      -- e.g. a storefront that was deleted from the cloud after historical stock movements already
      -- referenced it. Deliberately has NO foreign keys of its own — it must be able to hold any
      -- orphaned payload without itself becoming a second thing that can fail to insert. Never synced.
      CREATE TABLE sync_pull_orphans (
        entity TEXT NOT NULL,
        row_id TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        payload_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (entity, row_id)
      );
    `
  },
  {
    version: 63,
    name: "stock_movements_reference_index",
    sql: `
      -- Powers stock-receipt-repository.ts's "was this receipt a transfer from Main Store, or a
      -- plain purchase" lookup — a correlated subquery filtering stock_movements by
      -- (reference_type, reference_id) for every row in the Goods Received list. Without this index
      -- it's a full scan of stock_movements (one of the largest tables in the whole schema, growing
      -- with every sale/purchase/adjustment ever recorded) per receipt in the list, not just per
      -- page load.
      CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
    `
  },
  {
    version: 64,
    name: "invoice_cancellations",
    sql: `
      -- Same shape as sale_voids (request/approve/reject against a sale, no line items of its own) —
      -- see invoice-cancellation-service.ts's own doc comment for why a genuinely separate entity
      -- from sale_voids: an invoice cancellation always restocks AND (if anything was paid) reverses
      -- the payment as a real ledger entry, which sale_voids never does — different enough behavior
      -- to deserve its own table/audit trail rather than overloading sale_voids' meaning. Covers BOTH
      -- the immediate "Cancel Invoice" action (inserted pre-approved, requested_by == approved_by)
      -- and the manager-approval "Request Cancel" workflow (inserted pending, approved later) — one
      -- table, one code path, so getPaymentTransactions only ever has one place to look for "was this
      -- invoice's payment reversed, and when".
      CREATE TABLE IF NOT EXISTS invoice_cancellations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected')),
        reason TEXT NOT NULL,
        notes TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        synced_updated_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (requested_by) REFERENCES employees(id),
        FOREIGN KEY (approved_by) REFERENCES employees(id)
      );

      CREATE INDEX idx_invoice_cancellations_tenant_status ON invoice_cancellations(tenant_id, status);
      CREATE INDEX idx_invoice_cancellations_sale ON invoice_cancellations(sale_id);

      CREATE TRIGGER trg_invoice_cancellations_sync_ai AFTER INSERT ON invoice_cancellations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'invoice_cancellations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_invoice_cancellations_sync_au AFTER UPDATE ON invoice_cancellations WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'invoice_cancellations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_invoice_cancellations_sync_ad AFTER DELETE ON invoice_cancellations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'invoice_cancellations', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
    `
  },
  {
    version: 65,
    name: "purchase_shipping_cost",
    sql: `
      -- Freight/delivery cost for the whole order — see Purchase.shippingCostCents' own doc comment
      -- (shared/types/purchase.ts). Added on top of grand_total_cents, never folded into any single
      -- line's own cost.
      ALTER TABLE purchases ADD COLUMN shipping_cost_cents INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 66,
    name: "document_include_tax_breakdown",
    sql: `
      -- Per-document toggle for whether the "Tax Breakdown" section prints/downloads/shares on a
      -- receipt, invoice, or quotation — a few tenants' customers don't want it shown. Defaults to 1
      -- (today's behavior, unchanged) so nothing existing looks different until someone actually
      -- turns it off. Set once at creation (Checkout/Invoice/Quotation), editable afterward from each
      -- document's own detail view since a cashier will sometimes forget at creation time. Synced to
      -- SERVER (see sync-engine.ts's PAYLOAD_BUILDERS) so the public share link and Owner App reflect
      -- the same choice, not just this device's own printed/downloaded copy.
      ALTER TABLE sales ADD COLUMN include_tax_breakdown INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE quotations ADD COLUMN include_tax_breakdown INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    version: 67,
    name: "quotation_walk_in_customer",
    sql: `
      -- A quotation is non-binding (no money/credit at stake, unlike an invoice) — same reasoning
      -- Checkout's own walk-in sales already rely on (see sales.customer_id, already nullable since
      -- that table's very first migration). This was the one document type left requiring a real
      -- customer, which meant a quotation whose customer became genuinely unresolvable during sync
      -- (see resolveRef vs resolveRefOrNull in sync-engine.ts) failed to apply at all and eventually
      -- got permanently skipped — the whole quotation silently vanished from that device, not just its
      -- customer name. SQLite has no ALTER COLUMN, so this rebuilds the table with customer_id no
      -- longer NOT NULL; every other column/constraint/index is unchanged. Invoices deliberately keep
      -- requiring a real customer — this migration only touches quotations.
      CREATE TABLE quotations_new (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        quotation_number TEXT NOT NULL,
        customer_id TEXT,
        location_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        discount_amount_cents INTEGER NOT NULL DEFAULT 0,
        tax_amount_cents INTEGER NOT NULL DEFAULT 0,
        grand_total_cents INTEGER NOT NULL DEFAULT 0,
        valid_until TEXT NOT NULL,
        notes TEXT,
        converted_sale_id TEXT,
        converted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        synced_updated_at TEXT,
        include_tax_breakdown INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (location_id) REFERENCES locations(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        FOREIGN KEY (converted_sale_id) REFERENCES sales(id)
      );

      -- customer_id is FOREIGN KEY REFERENCES customers(id) on quotations_new below, and this
      -- connection always runs with PRAGMA foreign_keys = ON (connection.ts) — so the INSERT just
      -- below throws "FOREIGN KEY constraint failed" outright for any quotation whose customer_id
      -- doesn't resolve to a customer row that actually exists on THIS device. That's a real,
      -- reachable state, not a hypothetical: this migration's own header comment describes exactly
      -- this scenario (a quotation pulled from another device whose customer never itself finished
      -- syncing down locally) as the ORIGINAL bug being fixed here — under the OLD schema that pull
      -- either failed outright (NOT NULL) or, if some now-fixed earlier sync bug ever let a bad id
      -- through unresolved, left a genuinely dangling value sitting in this column already. Confirmed
      -- live: this is what turned migration 67 into a permanent crash loop for at least one real
      -- tenant (rolled back and retried, identically, on every single launch — see runInTransaction).
      -- Degrading straight to NULL (walk-in) here is exactly this migration's own stated intent for
      -- an unresolvable customer, just applied to a row already sitting in the table instead of one
      -- still arriving over sync. Done via a CASE in the SELECT below, not a separate UPDATE against
      -- the OLD "quotations" table first — that table's own customer_id is STILL NOT NULL at this
      -- point (this migration is what makes it nullable), so an UPDATE trying to null it out there
      -- would itself throw "NOT NULL constraint failed" (confirmed empirically). Reading it here and
      -- writing the resolved value straight into the new (nullable) table sidesteps that entirely.
      INSERT INTO quotations_new (
        id, tenant_id, quotation_number, customer_id, location_id, employee_id, status,
        subtotal_cents, discount_amount_cents, tax_amount_cents, grand_total_cents, valid_until,
        notes, converted_sale_id, converted_at, created_at, updated_at, sync_status, last_synced_at,
        synced_updated_at, include_tax_breakdown
      )
      SELECT
        id, tenant_id, quotation_number,
        CASE WHEN customer_id IS NOT NULL AND customer_id NOT IN (SELECT id FROM customers) THEN NULL ELSE customer_id END,
        location_id, employee_id, status,
        subtotal_cents, discount_amount_cents, tax_amount_cents, grand_total_cents, valid_until,
        notes, converted_sale_id, converted_at, created_at, updated_at, sync_status, last_synced_at,
        synced_updated_at, include_tax_breakdown
      FROM quotations;

      DROP TABLE quotations;
      -- Renaming quotations_new to the exact name ("quotations") that OTHER tables' triggers
      -- already reference in their body (quotation_items/sale_service_charges/delivery_notes' own
      -- reenqueue triggers, all untouched by the DROP above since they're bound to those OTHER
      -- tables) makes SQLite's default rename behavior try to rewrite/re-validate every trigger
      -- referencing the name mid-batch — and fail with "no such table: main.quotations", confirmed
      -- live. legacy_alter_table disables that rewrite pass for a plain rename (nothing here
      -- actually needs the rewrite: no trigger/view is bound to the OLD "quotations" name in a way
      -- that needs updating, they already say "quotations" and keep working unchanged once the
      -- table exists again under that same name).
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE quotations_new RENAME TO quotations;
      PRAGMA legacy_alter_table = OFF;

      CREATE UNIQUE INDEX idx_quotations_tenant_number ON quotations(tenant_id, quotation_number);
      CREATE INDEX idx_quotations_tenant_status ON quotations(tenant_id, status);
      CREATE INDEX idx_quotations_location ON quotations(location_id);
      CREATE INDEX idx_quotations_customer ON quotations(customer_id);

      -- DROP TABLE above silently dropped every trigger bound directly to quotations (SQLite ties a
      -- trigger to its target table) — recreated verbatim from migration 39's originals. Triggers on
      -- OTHER tables that merely SELECT FROM quotations inside their body (quotation_items,
      -- sale_service_charges, delivery_notes) are untouched — they were never bound to this table.
      CREATE TRIGGER trg_quotations_sync_ai AFTER INSERT ON quotations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'quotations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_quotations_sync_au AFTER UPDATE ON quotations WHEN NEW.updated_at != OLD.updated_at BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'quotations', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_quotations_sync_ad AFTER DELETE ON quotations BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'quotations', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
    `
  },
  {
    version: 68,
    name: "product_prices_tax_inclusive",
    sql: `
      -- Per-product override of the tenant's own default (tenant.prices_tax_inclusive) — a catalog is
      -- rarely uniform (e.g. imported goods priced exclusive of VAT sitting alongside locally-priced
      -- stock that already has VAT baked in). NULL means "inherit the tenant default", the state every
      -- existing product backfills to so nothing changes in behavior until an admin explicitly sets a
      -- product's own mode — see tax-calculation.ts's resolveProductTaxConfig, which every checkout/
      -- invoice/quotation/purchase calculation now resolves through instead of reading the tenant
      -- setting directly.
      ALTER TABLE products ADD COLUMN prices_tax_inclusive INTEGER;
    `
  },
  {
    version: 69,
    name: "working_hours_lockout",
    sql: `
      -- role.is_super_admin: server-authoritative "is this THE Super Admin role" flag — replaces a
      -- fragile role_name = 'Super Admin' string match (a tenant could rename or clone this role,
      -- either way silently breaking "Super Admin always retains access"). Backfilled for the
      -- already-seeded row below via role-service.ts's ensureSuperAdminFlag, called on every boot
      -- alongside its sibling ensure*/consolidate*/fix* functions in bootstrap.ts.
      ALTER TABLE roles ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;

      -- One row per storefront, created on-demand the first time a Super Admin configures hours for
      -- it (never boot-seeded, unlike roles/payment_methods/etc.) — drives the Working Hours lockout
      -- feature. schedule_json is keyed "0".."6" (0=Sunday..6=Saturday, JS Date.getDay()), one entry
      -- per day of {isOpen, openTime, closeTime}. See shared/lib/working-hours-lock.ts's
      -- computeWorkingHoursLockStatus for how these columns combine — that function is PORTED
      -- (not shared) from SERVER's own lib/working-hours-lock.ts of the same name, since this app
      -- must be able to compute lock status fully offline from its own locally-synced copy of this
      -- row; update both together if this logic ever changes.
      CREATE TABLE IF NOT EXISTS working_hours (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        lock_enabled INTEGER NOT NULL DEFAULT 0,
        lock_mode TEXT NOT NULL DEFAULT 'auto',
        manually_locked INTEGER NOT NULL DEFAULT 0,
        timezone_offset_minutes INTEGER NOT NULL DEFAULT 0,
        schedule_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        last_synced_at TEXT,
        -- Optimistic-lock baseline (see sync-engine.ts's CONFLICT_AWARE_ENTITIES/markSyncedBaseline)
        -- — a Super Admin's schedule edit shouldn't silently overwrite another device's more recent
        -- edit to the same storefront's hours, same protection every other mutable settings-like
        -- entity (roles, locations, payment_methods) already gets.
        synced_updated_at TEXT,
        UNIQUE (tenant_id, location_id),
        FOREIGN KEY (tenant_id) REFERENCES tenant(id),
        FOREIGN KEY (location_id) REFERENCES locations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_working_hours_tenant ON working_hours(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_working_hours_location ON working_hours(location_id);

      CREATE TRIGGER trg_working_hours_sync_ai AFTER INSERT ON working_hours BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'working_hours', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_working_hours_sync_au AFTER UPDATE ON working_hours BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), NEW.tenant_id, (SELECT client_id FROM tenant WHERE id = NEW.tenant_id), 'working_hours', NEW.id, 'upsert', 'push', 'queued', 0, '{}', NEW.id || ':' || NEW.updated_at || ':' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
      CREATE TRIGGER trg_working_hours_sync_ad AFTER DELETE ON working_hours BEGIN
        INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), OLD.tenant_id, (SELECT client_id FROM tenant WHERE id = OLD.tenant_id), 'working_hours', OLD.id, 'delete', 'push', 'queued', 0, '{}', OLD.id || ':deleted:' || lower(hex(randomblob(4))), datetime('now'), datetime('now'));
      END;
    `
  },
  {
    version: 70,
    name: "stock_receipt_main_store_before_after",
    sql: `
      -- Only ever populated for a Main Store transfer receipt item (see stock-receipt-service.ts's
      -- createStockReceipt) — the Main Store's OWN on-hand quantity immediately before/after this
      -- item was drawn out, alongside the already-existing previous_quantity/new_quantity columns
      -- (which describe the RECEIVING storefront's own stock). NULL for a plain purchase receipt.
      ALTER TABLE stock_receipt_items ADD COLUMN main_store_previous_quantity INTEGER;
      ALTER TABLE stock_receipt_items ADD COLUMN main_store_new_quantity INTEGER;
    `
  }
] as const;

export function migrateDatabase(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = db
    .prepare("SELECT version FROM migrations")
    .all()
    .map((row) => (row as { version: number }).version);
  const appliedSet = new Set(applied);

  for (const migration of migrations) {
    if (appliedSet.has(migration.version)) {
      continue;
    }

    try {
      runInTransaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
          migration.version,
          migration.name
        );
      });
    } catch (error) {
      // Rolled back by runInTransaction — this migration is NOT marked applied, so it retries
      // identically on every future launch until whatever's tripping it is fixed. Re-thrown with the
      // migration's own identity attached: index.ts's handleFatalStartupError surfaces this message
      // verbatim (dialog + startup-crash.log), and a bare SQLite error alone doesn't say WHICH of 60+
      // migrations actually failed — this is what makes that diagnosable from a field report instead
      // of guessed at.
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${cause}`, { cause: error });
    }
  }
}
