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
