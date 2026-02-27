const DEFAULT_JWT_EXPIRES_IN = '15m';
const DEFAULT_JWT_ISSUER = 'edu-bridge-api';
const DEFAULT_JWT_AUDIENCE = 'edu-bridge-client';

const asTrimmed = (value) => String(value || '').trim();

const resolveJwtExpiresIn = () => {
  const value = asTrimmed(process.env.JWT_EXPIRES_IN);
  if (!value) {
    return DEFAULT_JWT_EXPIRES_IN;
  }

  if (['0', 'false', 'none', 'off'].includes(value.toLowerCase())) {
    return DEFAULT_JWT_EXPIRES_IN;
  }

  return value;
};

const resolveJwtIssuer = () => asTrimmed(process.env.JWT_ISSUER) || DEFAULT_JWT_ISSUER;

const resolveJwtAudience = () => asTrimmed(process.env.JWT_AUDIENCE) || DEFAULT_JWT_AUDIENCE;

const buildSignOptions = (subject) => ({
  algorithm: 'HS256',
  expiresIn: resolveJwtExpiresIn(),
  issuer: resolveJwtIssuer(),
  audience: resolveJwtAudience(),
  subject: String(subject || ''),
});

const buildVerifyOptions = () => ({
  algorithms: ['HS256'],
  issuer: resolveJwtIssuer(),
  audience: resolveJwtAudience(),
});

module.exports = {
  buildSignOptions,
  buildVerifyOptions,
  resolveJwtExpiresIn,
  resolveJwtAudience,
  resolveJwtIssuer,
};
