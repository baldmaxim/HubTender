// (замещён bash-версией seed-staging-users.sh — backend использует bcrypt,
//  которого нет во встроенном node:crypto; хэш генерируется caddy hash-password.)
console.error('Используйте: bash scripts/staging/seed-staging-users.sh');
process.exit(1);
