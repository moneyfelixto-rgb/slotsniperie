export type FakeRow = {
  id?: string;
  delivery_id?: string | null;
  source?: string;
  event?: string;
  payload?: unknown;
  processed_at?: string | null;
  processing_error?: string | null;
  phone?: string;
  test_centre?: string;
  test_date?: string;
  test_time?: string;
  reference?: string | null;
  candidate_id?: string | null;
  amount_cents?: number;
  status?: string;
  expires_at?: string;
  [key: string]: unknown;
};

type Filter = { col: string; val: unknown };

type DbError = { code: string; message: string; details: string | null } | null;

/**
 * Just enough of the Supabase query builder for bot-event and the pay-page read.
 * Unique rules match bot_events.delivery_id and bookings_active_slot_uidx.
 */
export function createFakeSupabase() {
  const tables: { bookings: FakeRow[]; bot_events: FakeRow[] } = {
    bookings: [],
    bot_events: [],
  };

  function from(table: "bookings" | "bot_events") {
    const rows = () => tables[table];
    const state = {
      op: "select" as "select" | "insert" | "update" | "delete",
      payload: null as FakeRow | null,
      filters: [] as Filter[],
    };

    const matches = (row: FakeRow) => state.filters.every((f) => row[f.col] === f.val);

    const builder = {
      insert(row: FakeRow) {
        state.op = "insert";
        state.payload = { ...row };
        return builder;
      },
      update(row: FakeRow) {
        state.op = "update";
        state.payload = { ...row };
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        state.filters.push({ col, val });
        return builder;
      },
      gt() {
        return builder;
      },
      maybeSingle() {
        return execute(true);
      },
      then(
        onFulfilled: (value: { data: unknown; error: DbError }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return execute(false).then(onFulfilled, onRejected);
      },
    };

    async function execute(single: boolean): Promise<{ data: unknown; error: DbError }> {
      if (state.op === "insert") {
        const row = { ...state.payload };
        if (table === "bot_events") {
          if (!row.id) row.id = crypto.randomUUID();
          if (row.delivery_id != null) {
            const dup = rows().find((existing) => existing.delivery_id === row.delivery_id);
            if (dup) {
              return {
                data: null,
                error: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "bot_events_delivery_id_key"',
                  details: `Key (delivery_id)=(${String(row.delivery_id)}) already exists.`,
                },
              };
            }
          }
        }
        if (table === "bookings") {
          if (rows().some((existing) => existing.id === row.id)) {
            return {
              data: null,
              error: {
                code: "23505",
                message: 'duplicate key value violates unique constraint "bookings_pkey"',
                details: null,
              },
            };
          }
          const clash = rows().find(
            (existing) =>
              (existing.status === "pending" || existing.status === "paid") &&
              existing.test_centre === row.test_centre &&
              existing.test_date === row.test_date &&
              existing.test_time === row.test_time,
          );
          if (clash) {
            return {
              data: null,
              error: {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "bookings_active_slot_uidx"',
                details: `Key (test_centre, test_date, test_time)=(${String(row.test_centre)}, ${String(row.test_date)}, ${String(row.test_time)}) already exists.`,
              },
            };
          }
        }
        rows().push(row);
        return { data: null, error: null };
      }

      if (state.op === "update") {
        for (const row of rows()) {
          if (matches(row)) Object.assign(row, state.payload);
        }
        return { data: null, error: null };
      }

      if (state.op === "delete") {
        const kept = rows().filter((row) => !matches(row));
        rows().splice(0, rows().length, ...kept);
        return { data: null, error: null };
      }

      const found = rows().filter(matches);
      return { data: single ? (found[0] ?? null) : found, error: null };
    }

    return builder;
  }

  return {
    admin: { from },
    bookings: () => tables.bookings,
    events: () => tables.bot_events,
    reset() {
      tables.bookings = [];
      tables.bot_events = [];
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
