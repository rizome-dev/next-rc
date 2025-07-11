module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.test.ts',
    '**/e2e/**/*.e2e.test.ts',
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    '../*/src/**/*.ts',
    '!../*/src/**/*.d.ts',
    '!../*/src/**/__tests__/**',
    '!../*/src/**/index.ts',
    '!../*/src/**/types.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testTimeout: 30000,
  moduleNameMapper: {
    '^@rizome/next-rc-core$': '<rootDir>/../core/src',
    '^@rizome/next-rc-types$': '<rootDir>/../types/src',
    '^@rizome/next-rc-v8$': '<rootDir>/../v8-runtime/src',
    '^@rizome/next-rc-lattice$': '<rootDir>/../lattice/src',
    '^@rizome/next-rc-integration$': '<rootDir>/../next-integration/src',
  },
};