import { product } from "./product"

// Select this project's published package instead of an ambiguous global binary.
export const localMcpEntry = { command: "npx", args: ["--yes", `premiere-pro-mcp@${product.version}`] }
export const localMcpConfig = JSON.stringify({ mcpServers: { "premiere-pro-leancoderkavy": localMcpEntry } }, null, 2)
export const connectorSetup = `npx --yes premiere-pro-mcp@${product.version} --install-cep\nnpx --yes premiere-pro-mcp@${product.version} --doctor`
