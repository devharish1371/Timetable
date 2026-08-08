// src/crypto.js — AES encryption helpers using CryptoJS
import CryptoJS from "crypto-js";

const SALT = "tt-salt-v1"; // fixed prefix to avoid brute force ambiguity

export function encrypt(data, pin) {
  const key = pin + SALT;
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
}

export function decrypt(cipher, pin) {
  try {
    const key = pin + SALT;
    const bytes = CryptoJS.AES.decrypt(cipher, key);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  } catch {
    return null; // wrong PIN or corrupted data
  }
}

export function hashPin(pin) {
  return CryptoJS.SHA256(pin + SALT).toString();
}
