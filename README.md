# Brazi — dashboard gerencial

React + TypeScript, Fastify e PostgreSQL. Sincroniza a Reserva INK com segurança, mantém histórico persistente e apresenta indicadores comerciais, gráficos, produtos e conciliação. Contrato de origem: [docs/api-1.yaml](docs/api-1.yaml).

## Executar localmente

Requisitos: **Node.js 24.x** e npm. Configure também um banco PostgreSQL (local ou Supabase). A hospedagem gratuita prevista usa Render Free + Supabase Free.

```sh
npm ci
cp .env.example .env
chmod 600 .env
```

Edite `.env`, configure `DATABASE_URL` com a conexão privada do PostgreSQL e preencha `RESERVA_INK_TOKEN` com um token com `store.orders.read`, `store.products.read` e `store.refunds.read`. A Reserva INK documenta Bearer JWT/OAuth2 obtido via desenvolvedor; emissão e renovação automáticas não estão especificadas. Não compartilhe nem versione o token. Variáveis exportadas no processo têm precedência sobre `.env`.

Consulte [Supabase e Render Free](docs/render.md) para obter a URL pelo pooler e configurar TLS. Somente para PostgreSQL local fora de produção, use `sslmode=disable` com host loopback. O servidor não usa SQLite e recusa iniciar sem PostgreSQL acessível; nunca há fallback para disco efêmero.

Para a execução compilada:

```sh
npm run build
npm start
```

Abra `http://127.0.0.1:3000` no navegador da sua máquina. Clique em **Atualizar dados** para a primeira carga, ou sincronize previamente pelo terminal:

```sh
npm run sync
```

A primeira sincronização percorre todo o histórico, produtos e reembolsos relevantes. O tempo depende do volume de dados e dos limites da API; acompanhe o progresso no dashboard ou no terminal. O servidor e o comando de sincronização podem usar o mesmo banco: existe exclusão mútua entre cargas.

Para desenvolvimento com recarregamento:

```sh
npm run dev
```

Abra `http://127.0.0.1:5173`. O Vite encaminha `/api` ao Fastify na porta configurada por `PORT` (3000 por padrão). Não é necessário iniciar outro backend. Encerre com Ctrl+C.

## Configuração

| Variável | Padrão / finalidade |
| --- | --- |
| `RESERVA_INK_TOKEN` | Credencial privada; necessária somente para sincronizar |
| `PORT` | `3000`, servidor local |
| `DATABASE_URL` | Obrigatória; conexão PostgreSQL privada, usada somente no backend |
| `DATABASE_POOL_MAX` | `3`, máximo de conexões por processo (1–5) |
| `DATABASE_SCHEMA` | `brazi`, schema privado; mudar cria outro conjunto de dados |
| `DATABASE_CA_CERT` | Opcional; certificado PEM da CA oficial para verificação TLS |
| `TEST_DATABASE_URL` | Somente testes; banco local separado, nome terminado em `_test` |
| `BUSINESS_TIMEZONE` | `America/Sao_Paulo`, datas comerciais |
| `API_PAUSE_MS` | `1800`, pausa entre chamadas; mínimo permitido 1500 |
| `SYNC_MAX_PAGES` | `1000`, limite de segurança por coleção |
| `DIAGNOSTIC_MAX_PAGES` | `1000`, limite do diagnóstico legado |
| `DISPLAY_CURRENCY` | Opcional; por exemplo `BRL`, somente depois de confirmar moeda e unidade com a INK |

Sem `DISPLAY_CURRENCY`, os números são exibidos em **unidades da API**, sem presumir reais ou centavos da origem. Internamente, cada unidade decimal é subdividida em 100 partes para cálculo exato. Definir BRL apenas muda a apresentação; não converte valores nem confirma sua unidade.

O servidor funciona sem token para consultar um banco existente ou mostrar o estado inicial. Nunca use prefixos como `VITE_` para a credencial. `.env`, bancos antigos, exportações, backups, builds e resultados dos testes são ignorados pelo Git. O schema `brazi` é privado, tem RLS habilitada e não guarda dados pessoais de compradores. Não o exponha pela Data API do Supabase.

## Indicadores e regras comerciais

O indicador **Faturamento confirmado** é uma base comercial conservadora: pedidos atualmente `Pago` (ou códigos equivalentes `paid`/`succeeded`), com valor positivo, estrutura financeira válida, sem troca, sem reembolso e sem conflito operacional como `canceled`. Não é receita líquida definitiva nem comprovação de liquidação bancária.

- **Pedidos:** quantidade de pedidos elegíveis, cada ID contado uma única vez.
- **Ticket médio:** faturamento confirmado ÷ pedidos, arredondado ao centavo; zero quando não há pedidos.
- **Unidades vendidas:** unidades dos pedidos elegíveis, excluindo `free_quantity`.
- **Trocas:** `is_exchange=true` sempre fica separado; não reconhecemos uma cobrança adicional sem evidência.
- **Reembolsados e solicitações:** categorias separadas. Pedidos com reembolso parcial também ficam fora da base restrita; a parcela retida não é automaticamente reconhecida. Portanto, essa base não deve ser interpretada como venda líquida de devoluções.
- **Conciliação:** pagamentos pagos/cancelados, cancelados/entregues, histórico de reembolso ausente, reembolso sem aprovação, campos inválidos e outras divergências. A conciliação pode se sobrepor a reembolsos/trocas; seus cartões não devem ser somados.
- **Devolução/falha logística:** não deduz receita automaticamente de um pedido pago; aparece como risco logístico.
- **Gratuidade:** pedidos de total zero não entram no faturamento, pedidos confirmados ou ticket.

A identidade financeira observada e validada por pedido é:

```text
total_value = soma(items.total_value)
            + shipping_value
            - freight_value_difference
            - promotion_value
            - payment_discount_value
```

Os descontos já estão incorporados a `total_value`. O ranking usa receita de itens **sem frete**, atribuindo os descontos do pedido aos itens proporcionalmente ao seu total bruto. O método do maior resto faz o rateio fechar em centavos. Esta é uma convenção comercial explícita, não uma atribuição por item documentada pela INK. A soma do ranking, inclusive o grupo não associado, fecha com `faturamento confirmado − shipping_value + freight_value_difference` da mesma base.

Associação de produtos usa IDs opcionais **observados e validados na API real** nos objetos de produto/variante, sempre conferidos contra o catálogo conhecido, ou SKU documentado quando identifica um único produto. O OpenAPI não especifica as propriedades internas desses objetos, portanto os IDs são tratados como evidência de execução e não como obrigatórios. IDs conflitantes ou desconhecidos ficam em “Não associado ao catálogo”; nunca se associa por semelhança de nome. A inspeção real e as regras estão em [docs/integration-notes.md](docs/integration-notes.md). Produtos históricos são preservados para manter associações anteriores.

Os reembolsos exibidos são eventos aprovados ou aguardando aprovação **vinculados a pedidos criados no período selecionado**. Não são fluxo de caixa do período. O dashboard não deduz esses eventos da base confirmada, pois isso produziria dupla baixa de pedidos que já foram excluídos. Não há cálculo de faturamento líquido definitivo.

## Datas e comparação

Filtros são inclusivos, com datas de criação convertidas para `BUSINESS_TIMEZONE`. O período anterior tem a mesma quantidade de dias e termina no dia anterior ao início atual. Exemplo: 01–10/out compara com 21–30/set. Crescimento sobre base zero aparece como “Sem base anterior”, sem infinito.

Os indicadores históricos são recalculados com o estado atual de cada pedido; não são snapshots do estado na época nem fluxo de caixa. O gráfico diário alinha os intervalos pela posição do dia. O mensal agrupa por mês civil dentro do filtro; meses nas bordas podem ser parciais. Os atalhos de 7/30/90 dias e ano usam a data atual do fuso comercial. “Todo o período” usa a cobertura disponível no banco. Se alterar o fuso, execute uma nova sincronização integral antes de comparar resultados.

## Sincronização e consistência

Somente `GET` nos endpoints documentados de pedidos, produtos e históricos de reembolso. Paginação sequencial com `per_page=100`, conferência de totais, IDs únicos e contagem final. Toda carga relê pedidos antigos, pois a API não documenta filtro por atualização em pedidos; isso captura cancelamentos e reembolsos posteriores.

As chamadas têm timeout de 30 s. HTTP 429 respeita `Retry-After`, com pausa mínima de 60 s, backoff e tentativas limitadas; 502/503/504 e falhas de rede também têm tentativas limitadas. Credenciais nunca são encaminhadas em redirects. Proxies do ambiente e confiança TLS são preservados; não há desativação de certificados. HTTP 401/403 interrompe a carga e preserva os dados anteriores.

Pedidos e produtos são normalizados sem dados pessoais e publicados juntos em uma transação PostgreSQL, após consultar os históricos relevantes. UPSERT por ID impede duplicações; cada pedido tem seus itens substituídos pelo estado mais recente. Não persistimos buyer, endereços, CPF, telefone, e-mail, imagens de pedido, tokens ou respostas brutas.

Pedidos que desaparecerem da origem são conservados e enviados à conciliação. Não há exclusão silenciosa de vendas históricas. Cargas concorrentes são bloqueadas no banco, com heartbeat; uma execução interrompida pode ser retomada por uma nova carga após a concessão expirar (aproximadamente dois minutos). Falha ou cancelamento não substitui a última carga concluída.

Há índice por data e cache de agregados por versão da carga/período. Consultas do dashboard não fazem chamadas à INK. A carga ocorre em segundo plano, com progresso e última sincronização bem-sucedida visíveis.

A API não fornece snapshot transacional: totais estáveis e IDs únicos não excluem toda alteração em tempo real. Valores monetários fora dos formatos suportados ficam marcados para conciliação; não viram zero financeiro reconhecido. Decimais simples e formatos explícitos com agrupamento de milhares dos padrões americano/brasileiro são normalizados sem ponto flutuante. Frações longas de reembolsos, observadas na API real, são arredondadas ao centavo com regra meio para cima; perdas de fração não zero são sinalizadas para conciliação. Não se usa essa normalização para ocultar divergências na identidade financeira dos pedidos.

## Testes

```sh
npm test
npm run build
npm run test:e2e
```

Os testes de persistência e autenticação exigem PostgreSQL real. Crie um banco **local e exclusivo para testes**, com nome terminado em `_test`, e defina `TEST_DATABASE_URL` em `.env` (host loopback, `sslmode=disable`). Cada teste cria/remove um schema aleatório, sem acessar `DATABASE_URL` de produção. Ausência de banco é falha, não teste ignorado. Os testes E2E também removem seu schema isolado ao terminar.

Os testes de navegador usam Chromium em `/usr/bin/chromium`. Em outra máquina, defina `CHROMIUM_PATH` para um executável compatível, ou instale o Chromium pelo Playwright e configure esse caminho. Os testes E2E usam um schema PostgreSQL isolado, token desabilitado no servidor de teste e respostas simuladas; não alteram sua base nem chamam a INK.

A suíte cobre elegibilidade, cálculos decimais, rateio de centavos, reembolsos parciais, gratuidades, datas, períodos anteriores, SKU ambíguo, paginação, 429, persistência, idempotência, rollback, cache, proteção da atualização e uso da interface em desktop/celular. A validação real da base depende da sincronização com token válido.

O diagnóstico anterior permanece disponível com `npm run diagnose`, agora usando o mesmo transporte com proxy e backoff. Ele lista campos e somente status previstos em sua lista; o dashboard preserva os rótulos retornados e classifica também o português observado.

## Organização e produção

- `src/integration/`: acesso e sincronização da INK.
- `src/storage/`: PostgreSQL, migrações e publicação atômica de cargas.
- `src/domain/`: normalização, regras, valores monetários e indicadores.
- `src/dashboard-app.ts`: API local e arquivos compilados da interface.
- `web/`: interface React; nenhum acesso direto à INK.
- `test/` e `e2e/`: verificações automatizadas.

O projeto inclui [render.yaml](render.yaml) para **Render Free, sem disco**, e um [guia completo de Supabase Free + Render](docs/render.md). O React compilado é servido pelo Fastify na mesma origem; não é necessário um serviço pago nem um frontend separado. O banco fica no Supabase e não é perdido a cada deploy. Nenhum deploy foi executado.

Em produção, Fastify escuta em `0.0.0.0` usando `PORT`; autenticação, origem HTTPS e DATABASE_URL com TLS verificado são obrigatórios. Cookies Secure/HttpOnly/SameSite=Strict, proteção de origem, logout revogável e limites persistentes de login são preservados. Sessões ficam no PostgreSQL e sobrevivem a reinícios, com a mesma origem e credenciais.

Configure usuário e hash de senha apenas no ambiente. Gere o hash com `npm run auth:password` após o build, em terminal confiável; nunca inclua senha ou hash no Git. A conta é administrativa e única, sem cadastro público ou recuperação por e-mail. Em desenvolvimento a autenticação pode ficar desabilitada, com bind restrito ao loopback.

As migrações versionadas rodam transacionalmente na inicialização e também com `npm run migrate` / `npm run migrate:prod`. O build não conecta ao banco. Em produção, arquivos `.env` não são carregados; credenciais vêm exclusivamente do ambiente do processo. Para importar o SQLite anterior, veja o procedimento privado no guia; a importação exige destino comercial vazio e não transfere sessões. Mantenha a base antiga como backup privado até conferir os resultados.

Os planos gratuitos podem suspender por inatividade, limitar conexões, armazenamento, tráfego e horas de execução. Uma sincronização é um trabalho no processo web, sem garantia de conclusão se o Render suspender ou reiniciar. A última carga concluída permanece no PostgreSQL; execute novamente a carga completa após uma interrupção. Não há serviço de jobs ou disponibilidade contínua garantida.

Faça backups privados do PostgreSQL e teste a restauração. Não presuma backup automático ou recuperação pontual no plano gratuito. Nunca versione dumps ou URLs de conexão.

## Fase 2 / E1 — Inteligência de Produtos

Na branch `develop/phase-2`, a seção **Produtos** inclui ranking ordenável por unidades, pedidos e valor atribuído, evolução diária/mensal por produto, combinações de dois produtos e cobertura de catálogo. Busca e paginação são feitas no backend, sem novas chamadas à INK por visualização. O módulo reutiliza a classificação e o rateio do MVP; não requer migração de banco.

O ranking geral de pares considera até 100 produtos com mais unidades vendidas, informando cobertura e exclusões. Selecionar um produto mostra todos os parceiros associados, sem esse limite; a participação sempre usa todos os pedidos confirmados do período. Itens não associados permanecem no ranking e não viram um produto fictício nas cestas.

Consulte o [relatório E1 com critérios, endpoints, testes, limitações e capturas](docs/planning/phase-2-e1-delivery.md). Clientes, estampas, cores e modelagens não fazem parte desta entrega. A implementação está disponível para revisão, sem merge ou deploy em produção.
