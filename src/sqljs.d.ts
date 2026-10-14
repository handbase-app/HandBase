// Types minimaux de sql.js (SQLite compilé en WebAssembly), utilisé par le mode avancé de « Poser une question »
// (src/sqlWorker.ts, tools/test-sql.ts) : seulement ce qui sert ici.
declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null
  export interface QueryExecResult {
    columns: string[]
    values: SqlValue[][]
  }
  export interface Statement {
    run(params?: SqlValue[]): void
    free(): boolean
  }
  export interface Database {
    exec(sql: string): QueryExecResult[]
    run(sql: string, params?: SqlValue[]): Database
    prepare(sql: string): Statement
    create_function(name: string, fn: (...args: never[]) => unknown): Database
    close(): void
  }
  export interface SqlJsStatic {
    Database: new () => Database
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>
}
