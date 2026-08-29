import { describe, expect, it } from "vitest";
import http from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { OAuthResourceServer } from "../src/oauth-resource-server.js";

const configuration = {
  issuer: "https://identity.example.com",
  audience: "https://premiere.example.com/mcp",
  jwksUri: "https://identity.example.com/.well-known/jwks.json",
  publicUrl: "https://premiere.example.com",
  requiredScopes: ["premiere:mcp", "premiere:read"],
  allowedSubjects: ["user-1"],
};

const request = (authorization?: string) => ({ headers: { authorization } } as never);

describe("OAuth resource server", () => {
  it("publishes RFC 9728 metadata and a discovery challenge without secrets", () => {
    const resource = new OAuthResourceServer(configuration, async () => ({ sub: "user-1" }));
    expect(resource.metadata()).toEqual({
      resource: "https://premiere.example.com/mcp",
      authorization_servers: ["https://identity.example.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["premiere:mcp", "premiere:read"],
    });
    expect(resource.challenge()).toBe(
      'Bearer resource_metadata="https://premiere.example.com/.well-known/oauth-protected-resource/mcp", scope="premiere:mcp premiere:read"',
    );
    expect(resource.challenge("missing_token")).not.toContain("error=");
    expect(resource.challenge("insufficient_scope")).toContain('scope="premiere:mcp premiere:read"');
  });

  it("requires a bearer token, subject, and every configured scope", async () => {
    const valid = new OAuthResourceServer(configuration, async () => ({
      sub: "user-1", scope: "premiere:mcp premiere:read extra",
    }));
    await expect(valid.authenticate(request("Bearer signed-token"))).resolves.toEqual({
      authenticated: true,
      principal: { subject: "user-1", scopes: ["premiere:mcp", "premiere:read", "extra"] },
    });
    await expect(valid.authenticate(request())).resolves.toEqual({ authenticated: false, error: "missing_token" });
    await expect(valid.authenticate(request("Basic signed-token"))).resolves.toEqual({ authenticated: false, error: "missing_token" });

    const missingSubject = new OAuthResourceServer(configuration, async () => ({ scope: "premiere:mcp premiere:read" }));
    await expect(missingSubject.authenticate(request("Bearer token"))).resolves.toEqual({ authenticated: false, error: "invalid_token" });

    const missingScope = new OAuthResourceServer(configuration, async () => ({ sub: "user-1", scope: "premiere:mcp" }));
    await expect(missingScope.authenticate(request("Bearer token"))).resolves.toEqual({ authenticated: false, error: "insufficient_scope" });

    const wrongSubject = new OAuthResourceServer(configuration, async () => ({
      sub: "user-2", scope: "premiere:mcp premiere:read",
    }));
    await expect(wrongSubject.authenticate(request("Bearer token"))).resolves.toEqual({ authenticated: false, error: "invalid_token" });
  });

  it("fails closed when verification or JWKS retrieval fails", async () => {
    const resource = new OAuthResourceServer(configuration, async () => {
      throw new Error("identity provider unavailable");
    });
    await expect(resource.authenticate(request("Bearer token"))).resolves.toEqual({
      authenticated: false,
      error: "invalid_token",
    });
  });

  it("verifies signature, issuer, audience, lifetime, and required claims with remote JWKS", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const jwksServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
    const address = jwksServer.address();
    if (!address || typeof address === "string") throw new Error("Test JWKS server did not bind");

    try {
      const resource = new OAuthResourceServer({
        ...configuration,
        jwksUri: `http://127.0.0.1:${address.port}/jwks.json`,
      });
      const now = Math.floor(Date.now() / 1000);
      const validToken = await new SignJWT({ scope: "premiere:mcp premiere:read" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(configuration.issuer)
        .setAudience(configuration.audience)
        .setSubject("user-1")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
      await expect(resource.authenticate(request(`Bearer ${validToken}`))).resolves.toMatchObject({
        authenticated: true,
        principal: { subject: "user-1" },
      });

      const wrongAudience = await new SignJWT({ scope: "premiere:mcp premiere:read" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(configuration.issuer)
        .setAudience("https://attacker.example.com/mcp")
        .setSubject("user-1")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
      await expect(resource.authenticate(request(`Bearer ${wrongAudience}`))).resolves.toEqual({
        authenticated: false,
        error: "invalid_token",
      });

      const rejectedClaims = [
        new SignJWT({ scope: "premiere:mcp premiere:read" })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer("https://wrong-issuer.example.com")
          .setAudience(configuration.audience)
          .setSubject("user-1")
          .setIssuedAt(now)
          .setExpirationTime(now + 300),
        new SignJWT({ scope: "premiere:mcp premiere:read" })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(configuration.issuer)
          .setAudience(configuration.audience)
          .setSubject("user-1")
          .setIssuedAt(now)
          .setExpirationTime(now - 60),
        new SignJWT({ scope: "premiere:mcp premiere:read" })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(configuration.issuer)
          .setAudience(configuration.audience)
          .setSubject("user-1")
          .setIssuedAt(now)
          .setNotBefore(now + 300)
          .setExpirationTime(now + 600),
        new SignJWT({ scope: "premiere:mcp premiere:read" })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(configuration.issuer)
          .setAudience(configuration.audience)
          .setSubject("user-1")
          .setExpirationTime(now + 300),
      ];
      for (const builder of rejectedClaims) {
        const token = await builder.sign(privateKey);
        await expect(resource.authenticate(request(`Bearer ${token}`))).resolves.toEqual({
          authenticated: false,
          error: "invalid_token",
        });
      }

      const { privateKey: attackerKey } = await generateKeyPair("RS256");
      const badSignature = await new SignJWT({ scope: "premiere:mcp premiere:read" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(configuration.issuer)
        .setAudience(configuration.audience)
        .setSubject("user-1")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(attackerKey);
      await expect(resource.authenticate(request(`Bearer ${badSignature}`))).resolves.toEqual({
        authenticated: false,
        error: "invalid_token",
      });
    } finally {
      await new Promise<void>((resolve, reject) => jwksServer.close((error) => error ? reject(error) : resolve()));
    }
  });
});
