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

    runInTransaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name
      );
    });
  }
}
