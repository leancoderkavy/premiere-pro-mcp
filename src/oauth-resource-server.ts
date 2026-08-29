import type http from "node:http";
import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";
import type { HttpAuthConfiguration } from "./http-admission.js";

export interface AuthenticatedPrincipal {
  subject: string;
  scopes: string[];
  rateLimitKey: string;
}

export type AuthenticationResult =
  | { authenticated: true; principal: AuthenticatedPrincipal }
  | { authenticated: false; error: "missing_token" | "invalid_token" | "insufficient_scope" };

export interface OAuthResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ["header"];
  scopes_supported: string[];
}

type JwtVerifier = (token: string) => Promise<JWTPayload>;

function bearerToken(req: Pick<http.IncomingMessage, "headers">): string | undefined {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return undefined;
  const token = value.slice(7).trim();
  return token && token.length <= 16_384 ? token : undefined;
}

function tokenScopes(payload: JWTPayload): string[] {
  const scope = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  const scp = Array.isArray(payload.scp) ? payload.scp.filter((value): value is string => typeof value === "string") : [];
  return [...new Set([...scope, ...scp].filter(Boolean))];
}

export class OAuthResourceServer {
  private readonly verifyToken: JwtVerifier;
  private readonly rateLimitKeys: Map<string, string>;

  constructor(
    private readonly configuration: NonNullable<HttpAuthConfiguration["oauth"]>,
    verifier?: JwtVerifier,
  ) {
    this.rateLimitKeys = new Map(
      configuration.allowedSubjects.map((subject) => [subject, randomBytes(16).toString("hex")]),
    );
    if (verifier) {
      this.verifyToken = verifier;
      return;
    }
    const jwks = createRemoteJWKSet(new URL(configuration.jwksUri));
    this.verifyToken = async (token) => {
      const result = await jwtVerify(token, jwks, {
        issuer: configuration.issuer,
        audience: configuration.audience,
        algorithms: ["RS256", "ES256", "EdDSA"],
        clockTolerance: 5,
        requiredClaims: ["sub", "exp", "iat"],
      });
      return result.payload;
    };
  }

  metadata(): OAuthResourceMetadata {
    return {
      resource: this.configuration.audience,
      authorization_servers: [this.configuration.issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: this.configuration.requiredScopes,
    };
  }

  metadataUrl(): string {
    return `${this.configuration.publicUrl}/.well-known/oauth-protected-resource/mcp`;
  }

  challenge(error?: "missing_token" | "invalid_token" | "insufficient_scope"): string {
    const attributes = [
      `resource_metadata="${this.metadataUrl()}"`,
      `scope="${this.configuration.requiredScopes.join(" ")}"`,
    ];
    if (error && error !== "missing_token") attributes.push(`error="${error}"`);
    return `Bearer ${attributes.join(", ")}`;
  }

  async authenticate(req: Pick<http.IncomingMessage, "headers">): Promise<AuthenticationResult> {
    const token = bearerToken(req);
    if (!token) return { authenticated: false, error: "missing_token" };
    try {
      const payload = await this.verifyToken(token);
      if (!payload.sub || payload.sub.length > 255) return { authenticated: false, error: "invalid_token" };
      if (!this.configuration.allowedSubjects.includes(payload.sub)) {
        return { authenticated: false, error: "invalid_token" };
      }
      const scopes = tokenScopes(payload);
      if (!this.configuration.requiredScopes.every((scope) => scopes.includes(scope))) {
        return { authenticated: false, error: "insufficient_scope" };
      }
      return {
        authenticated: true,
        principal: {
          subject: payload.sub,
          scopes,
          rateLimitKey: this.rateLimitKeys.get(payload.sub)!,
        },
      };
    } catch (error) {
      if (error instanceof errors.JOSEError) return { authenticated: false, error: "invalid_token" };
      // Remote JWKS/network failures must fail closed without disclosing provider details.
      return { authenticated: false, error: "invalid_token" };
    }
  }
}
