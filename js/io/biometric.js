// Autenticación biométrica con WebAuthn
import { getSetting, setSetting } from '../db.js';

/**
 * Verifica si autenticación biométrica está disponible
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  try {
    if (typeof PublicKeyCredential === 'undefined') {
      return false;
    }
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available === true;
  } catch {
    return false;
  }
}

/**
 * Registra una credencial biométrica
 * @returns {Promise<boolean>}
 */
export async function register() {
  try {
    const available = await isAvailable();
    if (!available) {
      return false;
    }

    // Opciones de registro
    const options = {
      challenge: new Uint8Array(32), // en producción, aleatorio desde servidor
      rp: {
        name: 'Control de gastos',
        id: window.location.hostname,
      },
      user: {
        id: new Uint8Array(16),
        name: 'user@gastos.local',
        displayName: 'Usuario',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60000,
      attestation: 'none',
    };

    // Generar valores aleatorios
    crypto.getRandomValues(options.challenge);
    crypto.getRandomValues(options.user.id);

    try {
      const credential = await navigator.credentials.create({ publicKey: options });
      if (!credential || !credential.id) {
        return false;
      }

      // Guardar credential ID en base64
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.id)));
      await setSetting('biometricCredentialId', credentialId);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Autentica con credencial biométrica guardada
 * @returns {Promise<boolean>}
 */
export async function authenticate() {
  try {
    const credentialIdStr = await getSetting('biometricCredentialId');
    if (!credentialIdStr) {
      return false;
    }

    // Decodificar credential ID
    let credentialId;
    try {
      const binaryString = atob(credentialIdStr);
      credentialId = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        credentialId[i] = binaryString.charCodeAt(i);
      }
    } catch {
      return false;
    }

    // Opciones de autenticación
    const options = {
      challenge: new Uint8Array(32),
      timeout: 60000,
      allowCredentials: [
        {
          type: 'public-key',
          id: credentialId,
        },
      ],
      userVerification: 'required',
    };

    // Generar challenge aleatorio
    crypto.getRandomValues(options.challenge);

    try {
      const assertion = await navigator.credentials.get({
        publicKey: options,
      });
      return !!assertion;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
