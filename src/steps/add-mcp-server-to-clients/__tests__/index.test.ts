import { getSupportedClients } from '../index';
import { CursorMCPClient } from '../clients/cursor';
import { ClaudeMCPClient } from '../clients/claude';

jest.mock('../clients/cursor');
jest.mock('../clients/claude');

describe('getSupportedClients', () => {
  const MockedCursorMCPClient = CursorMCPClient as jest.MockedClass<
    typeof CursorMCPClient
  >;
  const MockedClaudeMCPClient = ClaudeMCPClient as jest.MockedClass<
    typeof ClaudeMCPClient
  >;

  beforeEach(() => {
    jest.clearAllMocks();

    MockedCursorMCPClient.mockImplementation(() => ({
      name: 'Cursor',
      isClientSupported: jest.fn().mockResolvedValue(true),
      getConfigPath: jest.fn(),
      isServerInstalled: jest.fn(),
      addServer: jest.fn(),
      removeServer: jest.fn(),
    }));

    MockedClaudeMCPClient.mockImplementation(() => ({
      name: 'Claude Desktop',
      isClientSupported: jest.fn().mockResolvedValue(true),
      getConfigPath: jest.fn(),
      isServerInstalled: jest.fn(),
      addServer: jest.fn(),
      removeServer: jest.fn(),
    }));
  });

  it('should return all clients when both are supported', () => {
    const result = getSupportedClients();

    expect(result).toHaveLength(2);
    expect(MockedCursorMCPClient).toHaveBeenCalledTimes(1);
    expect(MockedClaudeMCPClient).toHaveBeenCalledTimes(1);
  });

  it('should return only supported clients when some are not supported', () => {
    MockedCursorMCPClient.mockImplementation(() => ({
      name: 'Cursor',
      isClientSupported: jest.fn().mockResolvedValue(false),
      getConfigPath: jest.fn(),
      isServerInstalled: jest.fn(),
      addServer: jest.fn(),
      removeServer: jest.fn(),
    }));

    const result = getSupportedClients();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Claude Desktop');
  });

  it('should return empty array when no clients are supported', () => {
    MockedCursorMCPClient.mockImplementation(() => ({
      name: 'Cursor',
      isClientSupported: jest.fn().mockResolvedValue(false),
      getConfigPath: jest.fn(),
      isServerInstalled: jest.fn(),
      addServer: jest.fn(),
      removeServer: jest.fn(),
    }));

    MockedClaudeMCPClient.mockImplementation(() => ({
      name: 'Claude Desktop',
      isClientSupported: jest.fn().mockResolvedValue(false),
      getConfigPath: jest.fn(),
      isServerInstalled: jest.fn(),
      addServer: jest.fn(),
      removeServer: jest.fn(),
    }));

    const result = getSupportedClients();

    expect(result).toHaveLength(0);
  });
});
