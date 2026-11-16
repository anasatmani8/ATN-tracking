/** Node-only tests: pure domain rules, SQLite repositories (better-sqlite3) and sync. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/supabase'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', process.env.PG_TEST_URL ? '/__never__/' : '\\.pg\\.test\\.ts$'],
};
