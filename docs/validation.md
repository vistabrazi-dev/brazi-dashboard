# Validação da arquitetura PostgreSQL

Executada em ambiente de desenvolvimento em 15/10/2026 (UTC), antes da publicação no GitHub, sem deploy ou transferência de base real ao Supabase.

## Verificações

- PostgreSQL **17** real, local, isolado, com dados fictícios. Testes exigem TEST_DATABASE_URL local e banco com sufixo `_test`; cada caso cria/remove seu próprio schema.
- `npm test`: **46 testes passaram**, nenhum ignorado. Abrangem regras financeiras existentes, migrações, configuração TLS, persistência, autenticação, concorrência entre pools, rollback, 429 e sincronização completa com API simulada.
- `npm run build`: TypeScript do backend/interface e build Vite concluídos. Build não exige banco nem credenciais.
- `npm run test:e2e`: **5 testes Chromium passaram**, incluindo login/logout reais no backend conectado ao PostgreSQL, filtros, indicadores simulados e layout responsivo.
- `npm audit --audit-level=high`: nenhuma vulnerabilidade reportada no momento da verificação.
- Verificação dos arquivos candidatos a versionamento sem credenciais detectadas; arquivos privados continuam ignorados pelo Git.

As regras de `src/domain/` e a interface React foram preservadas. Um teste grava e relê uma coleção sintética em múltiplos lotes JSONB e compara integralmente os indicadores antes/depois, incluindo centavos, descontos, reembolsos, trocas e conflitos. Outros testes verificam idempotência, ausência da origem, persistência após reabertura do pool, falha no meio da transação e invalidação de cache por versão.

A migração de schema é exercitada com inicializações concorrentes, reaplicação idempotente e recusa de versão futura. RLS e ausência de grants públicos são verificadas. Concessão de sincronização e limite de login são exercitados por pools concorrentes. A importação SQLite é testada somente com arquivo fictício: preserva modelos comerciais, não copia sessões e recusa sobrescrever destino preenchido.

A sincronização de integração usa endpoints documentados com respostas fictícias, persiste pedidos/produtos/reembolsos no PostgreSQL e verifica que HTTP 401 posterior preserva a carga anterior. HTTP 429 é testado com espera simulada para conferir Retry-After sem esperar minutos.

Também foi verificado em processo isolado que a configuração de produção ignora `.env` e exige DATABASE_URL no ambiente do processo.

## Limites da validação

Não foi configurado nem acessado um projeto Supabase real nesta etapa. Conectividade ao pooler, cadeia TLS do provedor, cotas, suspensão e aceitação final do Blueprint precisam ser conferidas após configurar os serviços. Os testes de TLS verificam a configuração do driver, não um certificado Supabase real. Os testes HTTPS simulam o ingresso TLS do Render por cabeçalhos locais; não comprovam certificado publicado.

A base SQLite real foi preservada e não foi importada automaticamente. O procedimento privado de importação ou de nova sincronização está em [render.md](render.md). As limitações de suspensão dos serviços gratuitos, ausência de job durável e cuidados de backup também estão documentadas ali.

Não existe indicador de faturamento líquido definitivo enquanto houver pendências de conciliação. Nenhum dado comercial real, senha, hash de produção, cookie ou token faz parte deste relatório.
