# 2factor.digital

Implementação demo de autenticação em dois fatores com WhatsApp + passkey, front-end em Vite/React com componentes estilo shadcn e backend OAuth 2.1 com ingestão de tokens persistidos em SQLite.

## Como executar

1. Instale dependências

```bash
npm install
```

2. Inicie a API (gera SQLite em `server/data.sqlite`)

```bash
npm run dev:server
```

3. Em outro terminal, suba o front-end Vite

```bash
npm run dev
```

A UI estará em http://localhost:5173 e utilizará o proxy para alcançar a API em http://localhost:4173.

## Fluxo
- Informe o número de WhatsApp e clique em “Enviar código”. O OTP tem validade de 1 minuto e é salvo no SQLite.
- Valide o código para liberar o registro de passkey (simulada ou via WebAuthn quando disponível).
- A API registra a passkey e gera tokens OAuth 2.1 via endpoint de Token Ingestion, exibidos no perfil.
- Após a autenticação, o dashboard permite:
  - Registrar aplicações OAuth (nome + redirect URI) e listá-las.
  - Cadastrar servidores MTP/IdP que fornecerão login.
  - Visualizar tokens emitidos para o telefone corrente e revogá-los.
