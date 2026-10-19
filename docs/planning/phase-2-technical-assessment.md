# Brazi Business Intelligence — Fase 2: avaliação técnica e funcional

**Data:** 19/10/2026 — America/Sao_Paulo.  
**Situação:** auditoria de código e contrato concluída; proposta sujeita a aprovação. Nenhuma funcionalidade implementada.  
**Branch de trabalho:** `develop/phase-2`, HEAD auditado `cbc9d2f257368ee58eed3148ef58383bd467ae21`.  
**Baseline homologado:** `be218e443ab6a651a88ddb8d337159c11ecbe6d9`, preservado em `main` e `release/mvp-1.0` na consulta das referências remotas. A diferença do HEAD auditado para o baseline é somente o roadmap.

## 1. Parecer executivo

A arquitetura React + Fastify + PostgreSQL comporta a Fase 2 sem novos serviços pagos. A recomendação é ampliar seletivamente a coleta e acrescentar projeções analíticas, preservando os modelos e as regras financeiras do MVP.

As conclusões principais são:

1. **Clientes são uma dependência de dados, não apenas de cálculo.** Não há identidade de comprador persistida. O contrato de `buyer` e das respostas de `/customers` também não declara `id` ou `customer_id`. A rota `/customers/{id}` não resolve, sozinha, essa lacuna. Indicadores de clientes dependem de validar uma chave estável ou aprovar pseudonimização mínima e uma releitura histórica.
2. **Produtos permitem uma primeira entrega antes de resolver clientes.** Cestas por produto e evolução temporal por produto são calculáveis com os pedidos/itens atuais, respeitando os vínculos conhecidos e o grupo não associado. Ainda não são endpoints ou telas disponíveis.
3. **Cor, modelagem e tamanho existem no contrato, mas são descartados.** Estão em `product_variants`; `product_type` identifica o tipo de produto. Basta ampliar a normalização e persistência do catálogo, com validação semântica e histórica. Não se deve presumir que `model`, tipo de produto e modelagem comercial sejam sinônimos.
4. **Há uma fonte documentada para estampa:** `product_clusters` é descrito como agrupamento de estampa. O catálogo tem `product_cluster_id`. Não há nome de estampa no schema do cluster nem garantia de agrupamento completo. São necessárias coleta e conferência; produto, SKU, nome ou URL de imagem não substituem essa chave automaticamente.
5. **O estado histórico é reprocessado pelo estado atual.** A base conserva o último estado de cada pedido, sem eventos de pagamento ou snapshots financeiros históricos. RFM, coortes e acumulados devem ser descritos como compras elegíveis pela regra atual, não como receita liquidada ou fotografia da situação no passado.

**Ordem sugerida:** governança e qualidade → produtos/cestas e enriquecimento de catálogo → identidade e histórico de clientes → RFM/coortes → afinidade entre estampas e sugestões de kits. As frentes de produtos e identidade podem avançar independentemente após aprovação.

## 2. Escopo, evidências e limites

Foram examinados somente arquivos do repositório e referências Git, sem abrir `.env`, credenciais, SQLite real, banco Supabase, registros de compradores ou respostas reais da INK. Não houve chamada à API comercial, inicialização do servidor, sincronização, migração, deploy ou alteração de regras. A homologação em produção é informação fornecida pelo proprietário; esta análise não a substitui nem realiza nova auditoria da produção.

Fontes principais:

| Fonte | Evidência utilizada |
| --- | --- |
| [Roadmap](phase-2-roadmap.md) | Prioridades, baseline e critérios do planejamento inicial |
| [Contrato INK](../api-1.yaml) | OpenAPI 3.0.1, respostas inline, parâmetros, escopos e operações documentadas |
| [Migração inicial](../../src/storage/migrations/001-initial.ts), [migrador](../../src/storage/migrate.ts) | Tabelas físicas, tipos, índices, RLS e versão |
| [Modelos](../../src/domain/models.ts), [normalização](../../src/domain/normalize.ts) | Campos realmente retidos e descartados |
| [Regras](../../src/domain/rules.ts), [valores](../../src/domain/money.ts), [indicadores](../../src/domain/metrics.ts) | Base elegível, rateio, arredondamento, associações e fórmulas homologadas |
| [Persistência](../../src/storage/store.ts) | UPSERT, snapshots de leitura, cache indireto por versão, relações e concessões |
| [Sincronização](../../src/integration/sync.ts), [transporte](../../src/integration/transport.ts), [cliente INK](../../src/ink.ts) | Recursos integrados, paginação, pausas, retries e validações |
| [API de produção](../../src/dashboard-app.ts), [autenticação](../../src/auth/auth.ts), [servidor](../../src/server.ts) | Endpoints ativos e barreiras de acesso |
| [Interface](../../web/main.tsx), [configuração Render](../../render.yaml) | Filtros, telas e configuração de baixo custo |
| [Notas de integração](../integration-notes.md) | Evidências anteriores de IDs opcionais e limites do contrato; não verificadas novamente com dados reais |
| `test/`, `e2e/`, [validação anterior](../validation.md) | Cobertura existente e limites dos ensaios anteriores; resultados históricos não equivalem a execução nesta etapa |

Legenda de evidência:

- **Persistido:** existe no modelo normalizado ou em coluna física.
- **Documentado:** consta do OpenAPI, mas não comprova preenchimento, completude ou disponibilidade para o token/plano em produção.
- **Observado anteriormente:** há registro técnico de inspeção anterior, sem garantia adicional no contrato.
- **Proposto:** nome, estrutura ou regra da Fase 2; não é endpoint/campo existente na INK nem funcionalidade implementada.

Não foram medidos nesta etapa tamanho do banco, cobertura de identidades/variantes/clusters, cardinalidades reais, tempos ou cotas efetivas. Essas medições são dependências da implementação autorizada.

## 3. Inventário do PostgreSQL atual

### 3.1 Todas as tabelas físicas e seus campos

Schema padrão `brazi`, configurável por `DATABASE_SCHEMA`. São **oito tabelas**, contando `schema_migrations`. Não existem tabelas atuais de clientes, itens relacionais, cores, modelagens, estampas, coortes ou RFM.

| Tabela | Campos físicos e tipos | Chaves/índices e finalidade |
| --- | --- | --- |
| `orders` | `id BIGINT`, `day TEXT NOT NULL`, `data JSONB NOT NULL`, `seen BIGINT NOT NULL` | PK `id`; índice `orders_day(day)`. `day` é YYYY-MM-DD no fuso comercial; `seen` guarda a execução que viu o pedido |
| `products` | `id BIGINT`, `data JSONB NOT NULL` | PK `id`; catálogo normalizado, produtos históricos ausentes da carga não são apagados |
| `refunds` | `order_id BIGINT`, `data JSONB NOT NULL` | PK `order_id`; um documento de histórico por pedido |
| `runs` | `id INTEGER GENERATED ALWAYS AS IDENTITY`, `status TEXT NOT NULL`, `stage TEXT NOT NULL`, `page INTEGER NOT NULL DEFAULT 0`, `pages INTEGER NOT NULL DEFAULT 0`, `processed INTEGER NOT NULL DEFAULT 0`, `error TEXT`, `started_at TEXT NOT NULL`, `finished_at TEXT`, `heartbeat BIGINT NOT NULL` | PK `id`; índice único parcial `runs_one_active` sobre `status='running'`; progresso e concessão persistente |
| `meta` | `key TEXT`, `value TEXT NOT NULL` | PK `key`; o código grava a chave `timezone` |
| `auth_sessions` | `token_hash TEXT`, `credential_tag TEXT NOT NULL`, `expires_at BIGINT NOT NULL` | PK `token_hash`; índice em `expires_at`; hash SHA-256 de token opaco, vínculo à credencial e expiração em milissegundos |
| `auth_attempts` | `key TEXT`, `count INTEGER NOT NULL`, `reset_at BIGINT NOT NULL` | PK `key`; controle de tentativas por chave derivada de IP/credencial e chave global; tempo em milissegundos |
| `schema_migrations` | `version INTEGER`, `applied_at TIMESTAMPTZ NOT NULL DEFAULT now()` | PK `version`; versão atual de schema: migração 1, conforme código, sem afirmar estado do banco remoto |

Todas têm RLS habilitada pelo código de migração; acesso de PUBLIC, anon e authenticated é revogado. A aplicação usa o proprietário do schema. RLS habilitada não torna o usuário proprietário restrito nem substitui a autenticação HTTP. A conta administrativa do dashboard vem do ambiente: **sessão administrativa não é cliente/comprador**.

### 3.2 Todos os campos normalizados no JSONB

| Estrutura | Campos retidos, com tipos do domínio |
| --- | --- |
| `orders.data` / `Order` | `id:number`, `day:string`, `payment:string`, `status:string`, `exchange:boolean`, `missing?:boolean`, `total:number\|null`, `shipping:number\|null`, `freightDifference:number\|null`, `promotion:number\|null`, `paymentDiscount:number\|null`, `items:Item[]`, `issues:string[]` |
| `Order.items[]` / `Item` | `sku:string`, `sourceProductId?:number`, `sourceVariantId?:number`, `quantity:number`, `free:number`, `refunded:number`, `unit:number\|null`, `total:number\|null` |
| `products.data` / `Product` | `id:number`, `name:string`, `variants:{id:number, sku:string}[]` |
| `refunds.data` / `RefundHistory` | `orderId:number`, `events:Refund[]`, `issues:string[]` |
| `RefundHistory.events[]` / `Refund` | `id:number`, `status:string`, `partial:boolean`, `total:number\|null` |

Valores monetários normalizados são inteiros em centavos internos; isso não autoriza inferir moeda ou converter unidades da origem. JSONB não contém valores monetários brutos, dados de comprador, detalhes de entrega nem respostas completas. `issues` contém códigos de qualidade, não texto livre do comprador.

### 3.3 Relacionamentos existentes

- `orders.id` → `orders.data.items[]`: relação 1:N embutida. O `items[].id` documentado na API **não é persistido**; a posição no array não é uma identidade histórica estável.
- `Item.sourceProductId` → `products.id`: associação opcional, conferida no catálogo.
- `Item.sourceVariantId` → `Product.variants[].id` → produto: associação opcional, com verificação de conflito entre produto e variante. SKU só associa produto quando é unívoco na regra existente; não é chave universal garantida.
- `refunds.order_id` / `data.orderId` → `orders.id`: relação lógica 1:1 para o documento, com vários eventos dentro dele.
- `orders.seen` → `runs.id`: relação lógica de última observação; pedido ausente mantém `seen` anterior e recebe `missing=true` no JSONB.
- Não há FOREIGN KEY física nesses relacionamentos. Integridade depende dos adaptadores, validações e transação de gravação.
- `auth_sessions` e `auth_attempts` não têm relação com pedidos ou compradores. Não há chave para unir pedidos de uma mesma pessoa.

### 3.4 Persistência, temporalidade e sincronização

A sincronização relê pedidos e produtos integralmente e busca históricos dos pedidos relevantes para reembolso, inclusive históricos já presentes. Grava em lotes de até 500 dentro de uma transação; atualiza por ID, preserva ausências e publica a execução como concluída junto com o snapshot. Há bloqueio transacional para aquisição/publicação, heartbeat e concessão de aproximadamente dois minutos.

As leituras combinadas de dashboard usam `REPEATABLE READ READ ONLY`. A versão é a última execução bem-sucedida; o cache em memória tem até 12 combinações de versão/período. O repositório retorna pedidos por `day`, mas o endpoint atual busca **somente o intervalo atual mais o intervalo anterior**. Isso é insuficiente para descobrir primeira compra global ou RFM histórico: essas consultas precisarão de histórico anterior ao filtro.

Limites temporais:

- `created_at` vira apenas `day`; hora, minuto e offset originais não ficam no banco. Coortes mensais e recência em dias são possíveis após resolver identidade; ordem exata de compras no mesmo dia não é recuperável apenas da persistência atual.
- Não há `paid_at`, `canceled_at`, histórico de status ou snapshots analíticos por data. O contrato de pedidos não documenta esses campos nem filtro por atualização de pedido. Não inventar filtro `updated_since`.
- Datas de execução não são datas de venda. Os timestamps de eventos de reembolso documentados também são descartados na normalização atual.
- Catálogo representa a última informação coletada, não a variante ou agrupamento exatamente como existia no dia da venda. Produtos ausentes são conservados, mas variantes de um produto atualizado podem desaparecer da lista atual.
- `coverage.first/last` mede datas dos pedidos presentes, não prova que nunca houve pedido anterior, exclusão na origem ou falha de identificação.

## 4. Inventário do contrato Reserva INK e das APIs locais

### 4.1 Autenticação, recursos usados e paginação

O contrato usa base `https://api.reserva.ink`, Bearer JWT/OAuth2 obtido via desenvolvedor. O backend atualmente integra somente GET de `/v1/stores/orders`, `/v1/stores/products` e `/v1/stores/orders/{order_id}/refunds`. Escopos explícitos: `store.orders.read`, `store.products.read`, `store.refunds.read`.

Lista de pedidos: `payment_status`, `order_status`, `begin_date`, `end_date`, `is_exchange`, `page`, `per_page`. As datas filtram **criação**, com dias inteiros inclusos. Produtos: `visible_in_store`, `approval_status`, `begin_date`, `end_date`, `page`, `per_page`; datas também são de criação. Não usar filtros que excluam itens históricos ao completar a carga analítica.

Coleções principais retornam seu array e `page`, `per_page`, `total_pages`, `total_count`. Pedidos, produtos, clusters e tipos documentam máximo 100 por página; **clientes só declara padrão 10**, sem máximo no parâmetro. Não transportar a suposição de máximo 100 para todos os recursos. O coletor atual valida IDs e contagens e só aceita recursos orders/products; clientes exigem adaptador próprio, pois o schema documentado não tem ID.

Transporte atual: pausa padrão 1.800 ms; mínimo configurável 1.500 ms; timeout de 30 s; tentativas limitadas; em HTTP 429 respeita Retry-After e espera ao menos 60 s; espera solicitada superior a dez minutos interrompe a tentativa. Rede e 502/503/504 têm retries limitados; 401/403 não são repetidos. O contrato local não estabelece uma cota universal em requisições/minuto. Preservar o limitador comum ao acrescentar recursos; a pausa não garante que nunca ocorrerá 429. A API não oferece snapshot transacional das páginas.

### 4.2 Clientes e histórico de compras

Referências: [lista de clientes](../api-1.yaml#L1212), [detalhe](../api-1.yaml#L1320), [pedidos/buyer](../api-1.yaml#L2691).

| Fonte | Campos documentados | Disponibilidade atual / confiabilidade |
| --- | --- | --- |
| `/customers` → `customers[]` | `accepts_marketing`, `document`, `email`, `first_name`, `last_name`, `phone` | Não integrado. Nenhum `id`, `created_at`, `orders_count`, acumulado ou lista de compras no schema |
| `/customers/{id}` → `customer` | Os mesmos seis campos; envelope com `status` | Existe a rota, mas a resposta/lista não fornece uma chave `id` documentada para descobrir e relacionar clientes |
| `orders[].buyer` | `first_name`, `last_name`, `email`, `phone`, `document`, `accepts_marketing` | Recebido na resposta, descartado; nenhum `buyer.id`/`customer_id` documentado |
| Compras por cliente | Pedidos possuem `id` e `created_at`, mas não uma chave de cliente documentada | Não existe endpoint de histórico de compras por cliente no contrato nem filtro `customer_id` em `/orders` |

`/customers` filtra `query` por primeiro nome, email ou documento, além de paginação. Uma busca por dado pessoal para cada pedido é desnecessária e cara; não recomendar N+1. Consultar `/customers/{id}` também não garante obter pedidos associados.

**Bloqueio de identidade:** validar com a INK se existe chave técnica estável retornada, sua semântica, escopo por loja e disponibilidade histórica. Qualquer campo extra observado precisa de evidência antes de se tornar dependência; não declarar `buyer.id` como disponível. Se não houver chave técnica, uma alternativa condicionada à aprovação é HMAC de um identificador mínimo obtido de `buyer`, processado apenas em memória. Email compartilhado/trocado, ausências e documentos inconsistentes podem fundir ou fragmentar pessoas. Nem nome nem telefone devem ser usados para uniões heurísticas automáticas.

### 4.3 Pedidos, valores, cancelamentos e itens

O detalhe `/orders/{id}` documenta o mesmo conjunto de campos de pedido, com envelope `status/order`; não corrige as lacunas de identidade nem documenta data de pagamento. Inventário dos campos documentados relevantes e sua retenção:

| Grupo | Campos documentados | Situação na normalização |
| --- | --- | --- |
| Identificação e criação | `id`, `created_at`, `rsv_factory_id` | `id` e dia comercial; perde timestamp completo e referência de fábrica |
| Status e modalidade | `order_status`, `formatted_order_status`, `payment_method`, `payment_status`, `is_exchange`, `exchangeable`, `items_editable` | Guarda `status`, `payment`, `exchange`; demais descartados |
| Valores | `total_value`, `payment_discount_value`, `promotion_value`, `shipping_value`, `freight_value_difference`, `kickback_value` | Guarda os cinco primeiros como centavos; `kickback_value` descartado e não é receita do MVP |
| Promoção | `promotion_code` | Descartado; valor agregado de desconto já existe, atribuição por cupom não |
| Pagamento Pix | `pix.qr_code`, `pix.expiration_date` | Não persistidos; não necessários para inteligência comercial |
| Entrega | `tracking_url`; `delivery.carrier`, `delivery_method`, `shipping_type`, `tracking_code`, `current_status`, `production_deadline`, `production_lead_time_days`, `production_delayed`, `estimated_delivery_date`, `delivery_delayed`, `delivered_at` | Não persistidos; entrega não equivale a confirmação financeira |
| Histórico logístico | `delivery.history[].event`, `event_type`, `description`, `observation`, `created_at` | Não persistido; não é histórico de pagamentos |
| Comprador | Os seis campos de `buyer` acima | Todos descartados |
| Endereços | `shipping_address` e `billing_address`: `state`, `street`, `number`, `complement`, `city`, `cep`, `neighbourhood`, `name` | Não persistidos; não necessários aos KPIs desta fase |
| Identidade do item | `items[].id`, `sku`, `product_variant`, `product_v2` | `sku` retido; item `id` descartado. Os dois objetos são opacos no schema; `.id` é captura opcional observada anteriormente, validada no catálogo |
| Quantidades e valores do item | `quantity`, `unit_value`, `total_value`, `free_quantity`, `refunded_quantity` | Retidos como `quantity`, `unit`, `total`, `free`, `refunded` |
| Produção e mídia do item | `created_at`, `produced_at`, `produced`, `counter_produce`, `art_image_url`, `mockup_image_url` | Descartados; imagem/URL não é identidade estável de estampa, sobretudo para personalização |
| Componentes comerciais do item | `unit_ink_base_price`, `unit_additional_service_price`, `unit_kickback_without_promotion_value` | Descartados; não fornecem, sozinhos, margem líquida homologada |

O filtro `payment_status` documenta: `pending`, `paid`, `succeeded`, `waiting_payment`, `awaiting_analysis`, `free`, `refund_requested`, `refunded`, `canceled`, `failed`, `expired`, `not_authorized`, `dispute`, `chargeback`.

O filtro `order_status` documenta: `waiting_payment`, `awaiting_analysis`, `payment_refused`, `expired`, `paid`, `refund_requested`, `refunded`, `canceled`, `waiting_approval`, `awaiting_stamp`, `awaiting_production`, `production_delayed`, `waiting_to_be_sent`, `waiting_to_be_collected`, `sent`, `preparing_for_delivery`, `delivery_in_progress`, `left_for_delivery`, `delivery_failure`, `delivery_interrupted`, `waiting_sender_action`, `return_started`, `returned`, `delivered`, `delivered_correios`.

Esses enums de filtro não garantem o idioma das respostas. A aplicação preserva os rótulos recebidos e reconhece explicitamente equivalências em português. Esta etapa não afirma quais status estão efetivamente presentes na base homologada. Cancelamentos são classificáveis pelo estado atual, mas não por data/evento histórico de cancelamento não persistido.

### 4.4 Produtos, variantes, estampas e modelagens

Referências: [produtos](../api-1.yaml#L4663), [clusters](../api-1.yaml#L3899), [tipos](../api-1.yaml#L4139). Os detalhes por ID repetem esses esquemas em envelopes singulares.

| Fonte | Campos documentados | Persistência e utilidade |
| --- | --- | --- |
| Produto | `id`, `name`, `slug`, `description`, `store_product_url`, `visible_in_store`, `customizable_by_buyer`, `total_sales_count`, `product_cluster_id`, `price`, `promotional_price`, `tags`, `main_image_url`, `approval_status`, `status`, `created_at`, `updated_at` | Só `id/name` ficam. Cluster é candidato documentado a chave de estampa; preços atuais e contadores acumulados não substituem receita histórica |
| `product.store` | `id`, `name`, `slug` | Descartado; modelo atual é de uma loja, não um warehouse multiempresa |
| `product.product_type` | `id`, `name` | Descartado; útil para tipo/categoria de peça, não automaticamente a modelagem comercial |
| `product.product_variants[]` | `id`, `sku`, `color`, `hex_color`, `size`, `model`, `is_available`, `available_quantity`, `sales_count`, `created_at` | Só `id/sku` ficam. Cor/modelo/tamanho são enriquecimento documentado, frequentemente nullable. `sales_count` não fornece período nem exclusões homologadas |
| `/product_clusters` | `id`, `default_product_id`, `product_ids[]`, `created_at`, `updated_at` | Não integrado. A descrição afirma agrupamento de estampa, inclusive aplicação em tipos diferentes. Não há `name`/nome oficial da estampa no schema |
| `/product_types` | `id`, `name`, `type`, `options[].name`, `options[].values[]`, `printable_areas[]` | Não integrado. Opções descrevem modelo/cor/tamanho; não provam variante vendida |
| `product_types[].printable_areas[]` | `base_image_id`, `description`, `model`, `color.name`, `color.hex`, `filter`, `mockup_url`, `print_area.width`, `print_area.height` | Áreas/templates de impressão, não IDs de estampas comercializadas |

O escopo de clusters é `store.products.read`; tipos exigem `store.product_types.read`. Acrescentar tipos é opcional se variantes e tipo embutido bastarem; evitar pedir escopos desnecessários. A lista de produtos já inclui todos os status/visibilidades quando não filtrada.

A primeira classificação de estampa pode usar `cluster.id` **após conferir** `product_cluster_id` versus `product_ids`. Sem cluster, mostrar “Estampa não identificada”, sem presumir que cada produto corresponde a uma estampa distinta. O nome do produto de vitrine pode ser rótulo de apresentação claramente identificado, não nome oficial de estampa. Conflitos, produtos removidos e personalizações devem ficar sem associação validada. Não agrupar por semelhança de nome, imagem ou SKU.

### 4.5 Reembolsos, trocas e descontos complementares

- `/orders/{order_id}/refunds` documenta `id`, `status`, `reason`, `reason_description`, `created_at`, `updated_at`, `reviewed_at`, `partial`, `total_refund_amount`, `total_ink_refund_amount`, `total_seller_refund_amount`, `refunded_items[].id`, `refunded_items[].requested_quantity`, `refunded_items[].order_item` (objeto sem propriedades). Só ID/status/partial/total e códigos de qualidade são guardados. Não é possível hoje distribuir reembolso por variante com rastreabilidade; não inventar campos dentro de `order_item`.
- `/exchanges` e detalhe documentam `id`, `exchange_type`, `status`, `is_courtesy_exchange`, motivos e rótulos, `problem_description`, `support_review_status`, `refusal_reason`, `refusal_reason_code`, `refusal_reason_label`, `refusal_note`, `reviewed_at`, `old_order_returned_to_cd`, `old_order`, `new_order`, `old_external_order`, `new_external_order`. Os vínculos de pedidos são objetos opacos. Não integrado; o MVP usa `is_exchange` e mantém trocas separadas. Escopo `store.exchanges.read`.
- `/promotions` e detalhe documentam `id`, `type`, `code`, `kind`, `apply_automatically`, `list_type`, `progress_kind`, `usage_limit`, `first_purchase`, `show_on_product_page`, `show_in_cart`, `starts_at`, `expires_at`, `available`, `discount_tiers[].min_cart_value/min_cart_items/discount`, `product_ids`, `product_type_ids`, `collection_ids`, `created_at`, `updated_at`. Escopo `store.promotions.read`; não integrado. A promoção atual não prova a promoção vigente na venda. Valor do desconto por pedido já está disponível, sem necessidade desse recurso para os KPIs solicitados.
- `/collections` e detalhe documentam `id`, `name`, `slug`, `description`, `is_available`, `position`, `product_ids`, `kit_ids`, `created_at`, `updated_at`. Escopo `store.categories.read`; não integrado. `kit_ids` não equivale a um endpoint de catálogo/composição de kits, que não existe neste contrato. Kits desta fase serão recomendações analíticas, não publicação de kits na plataforma.

### 4.6 Endpoints HTTP da aplicação

| Método / rota ativa | Finalidade e acesso |
| --- | --- |
| `GET /health` | Público, resposta mínima, sem inventário comercial |
| `GET /api/auth/session` | Público para estado de autenticação; não retorna dados comerciais |
| `POST /api/auth/login` | Login; origem/cabeçalho/JSON e limite de tentativas |
| `POST /api/auth/logout` | Sessão, origem/cabeçalho/JSON; revoga token |
| `GET /api/status` | Autenticado em produção; execução, última carga, cobertura, versão, timezone/moeda e presença de token |
| `GET /api/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD` | Autenticado; indicadores, comparação, séries gerais, ranking, categorias, conciliação, status e reembolsos |
| `POST /api/sync` | Autenticado em produção e protegido contra origem indevida; dispara trabalho local |
| `GET /`, `/login`, `/index.html`, `/favicon.svg`, `/assets/...` | Shell/arquivos públicos da interface; as APIs comerciais permanecem protegidas |

`src/app.ts` ainda define `/api/orders` e `/api/products` para diagnóstico agregado, mas **esse factory não é conectado por `src/server.ts`**. Não confundir código legado de diagnóstico com endpoints disponíveis no serviço de produção. Não existem rotas atuais de clientes, RFM, coortes, variantes ou afinidade. A UI tem Visão geral, Produtos e Conciliação; filtros de período e comparação já existem, mas o ranking não tem drill-down temporal por produto.

## 5. Base comum e preservação financeira

Todas as fórmulas abaixo são propostas para novos indicadores; a elegibilidade e os montantes continuam exatamente os do MVP.

Notação:

- `P=[s,e]`: intervalo inclusivo no fuso comercial configurado, padrão America/Sao_Paulo; `D=e` como corte de observação.
- `E(P)`: pedidos classificados como `confirmed` por `classify()` com o histórico de reembolso correspondente, criados em P. `E(≤D)` considera todo o histórico disponível até D.
- `c(o)`: chave de cliente validada, ainda inexistente no banco. Pedidos sem identidade ficam em grupo desconhecido, nunca viram um cliente por pedido.
- `t(o)`: data de criação comercial; timestamp completo será necessário para ordenar compras dentro do dia.
- `n_c(P)=count distinct order.id` de c em E(P); `V_c(P)=sum(order.total)` desses pedidos.
- `q_i=item.quantity-item.free`; não subtrair `refunded` novamente nem reconhecer receita parcial diferente da regra homologada.
- `r_i=item.total - desconto_rateado_i`, com `allocate(promotion+paymentDiscount, pesos=item.total)` e maior resto exatamente como no MVP. Receita por produto/dimensão **exclui frete**. Não refazer o rateio apenas sobre itens reconhecidos ou selecionados.

Regras preservadas:

1. Base confirmada: pagamento reconhecido como pago, total positivo e estrutura válida, sem troca, reembolso, pendência de reembolso ou motivos de conciliação. Gratuitos de total zero não entram em pedidos/ticket confirmados. Estados desconhecidos não viram pagos.
2. Precedência de categorias: troca → reembolsado → reembolso pendente → conciliação por problemas → pago confirmado/gratuito → não pago. Motivos de conciliação também podem aparecer em trocas/reembolsados; cartões não são somáveis indiscriminadamente.
3. Devolução/falha logística não reduz automaticamente um pedido pago elegível; o risco aparece separado.
4. Identidade financeira: `total_value = Σ items.total_value + shipping_value - freight_value_difference - promotion_value - payment_discount_value`.
5. Montantes internos inteiros; somas/rateios exatos. Fração adicional de reembolso segue o arredondamento existente e marca conciliação. Não substituir inválidos por receita zero.
6. Ticket global e por cliente usam total do pedido, incluindo frete líquido da diferença; rankings de produtos usam r_i. As duas bases não devem ser comparadas sem explicar o frete.
7. Não há faturamento líquido definitivo nem LTV preditivo. Moeda/unidade seguem configuração homologada, sem nova inferência.
8. Cancelamentos/reembolsos posteriores podem retirar uma venda da base confirmada e mudar primeira compra, RFM e coorte recalculados. Isso é consequência do estado atual preservado; uma análise financeira “como era na data” exigiria eventos/snapshots adicionais e outro escopo aprovado.

## 6. Matriz de viabilidade — inteligência de clientes

**Situação comum:** todos os KPIs de cliente estão **bloqueados na persistência atual** por falta de identidade. O contrato oferece identificadores pessoais candidatos, mas não uma chave técnica garantida. Depois de validar identidade, releitura histórica e cobertura, os cálculos abaixo são tecnicamente viáveis sem serviços externos.

| Indicador | Fórmula proposta / granularidade | Campos necessários | Disponibilidade e confiabilidade | Dependência/limitação |
| --- | --- | --- | --- | --- |
| Clientes novos | `count(c ativo em P com first_c ∈ P)`, `first_c=min t(o)` em todo E(≤D) | Identidade, pedido ID, criação, elegibilidade, histórico anterior a s | Datas/valores persistidos; identidade ausente; buyer com email/document documentados | Sem histórico completo, chamar “primeira compra observada”, não novo absoluto; cadastro não é compra |
| Clientes recorrentes | `count(c ativo em P com first_c<s)` | Mesmos campos | Bloqueado hoje; calculável após vínculo/backfill | Novos e recorrentes particionam clientes identificados ativos em P. Quem faz primeira e segunda compras dentro de P continua cliente novo nessa partição; a segunda compra é uma recompra |
| Frequência de compra | `Σ n_c(P) / count(c com n_c(P)>0)`; por cliente, exibir `n_c(P)` | Identidade, IDs distintos e datas de pedidos confirmados | Bloqueado hoje; valor por pedido confiável na base homologada | Informar janela e cobertura. Frequência RFM é contagem, não média global. Cadência opcional: média por cliente de `(última−primeira)/(n−1)` para n≥2; só em dias até reter timestamps |
| Taxa de recompra | Para coorte de primeira compra em P e janela W: `clientes com segunda compra até first_c+W / clientes da coorte com first_c+W≤D ×100` | Identidade e histórico completo; primeira/segunda compra; data de corte | Bloqueado hoje; viável com identidade e coorte madura | W deve ser aprovado, por exemplo 90 dias. Clientes imaturos saem do denominador e são informados; sem denominador, null. Proporção de compradores ativos com ≥2 compras é outra métrica, não esta taxa |
| Ticket médio por cliente | `V_c(P)/n_c(P)` com o mesmo arredondamento do ticket MVP | Identidade, `total`, IDs elegíveis | Valores disponíveis, identidade ausente | Não confundir média dos tickets individuais com ticket global; este é ponderado por pedidos. Frete incluído conforme MVP |
| Valor acumulado por cliente | `V_c(≤D)` no histórico conhecido | Identidade, montantes e elegibilidade de todo o histórico | Bloqueado hoje; viável após backfill | “Valor confirmado acumulado observado”; não margem, caixa, receita líquida definitiva ou LTV previsto. Sem identidade permanece no agregado desconhecido |
| Segmentação RFM | `R_c=D−max t(o)`, `F_c=n_c([D−L+1,D])`, `M_c=V_c([D−L+1,D])`; recência usa todo histórico ≤D. Proposta inicial L=365 dias | Identidade, datas, total e elegibilidade; corte e janela explícitos | Bloqueado hoje; cálculo viável após identidade | Incluir compradores anteriores sem compra na janela: F=M=0, R real; nunca recência zero por falta de data. Escores propostos 1–5, menor R melhor, F/M maiores melhores; empates preservados e cortes versionados. N pequeno não justifica quintis artificiais nem rótulos fortes |
| Coortes e retenção | Coorte = mês da primeira compra elegível observada. `retenção(g,m)=clientes de g com compra no mês g+m / clientes de g ×100` | Identidade, primeira compra global, datas dos demais pedidos | Bloqueado hoje; viável após histórico auditável | Mês comercial; cada cliente conta uma vez por célula. Meses ainda não completos são null/incompletos, não zero. M0 é base, não recompra. Cobertura esquerda e alterações retroativas de status mudam os resultados |

Regras de apresentação/aceite comuns: mostrar última sincronização, D, janela, quantidade identificada, pedidos/valor sem identidade e início da cobertura histórica. Ao reconciliar valores, `Σ valor por cliente identificado + valor sem identidade = faturamento confirmado` para o mesmo recorte e versão. Ausências de identidade nunca podem inflar novos clientes ou reduzir silenciosamente o denominador publicado.

## 7. Matriz de viabilidade — inteligência de produtos

| Indicador | Fórmula proposta / granularidade | Campos necessários | Viabilidade com estrutura atual | Limitações e ajuste necessário |
| --- | --- | --- | --- | --- |
| Ranking por estampa | `receita_g=Σ r_i`, `unidades_g=Σ q_i`, `pedidos_g=count distinct order.id` por cluster/estampa | Item→produto, `product_cluster_id`, membros de cluster; item/preço/quantidades e elegibilidade | **Enriquecimento necessário**: dinheiro/itens existem; clusters são documentados e não persistidos | Ler catálogo ampliado e clusters, validar cobertura; rótulo sem nome oficial; grupo desconhecido; classificação atual pode mudar o passado |
| Ranking por modelagem | Mesmas somas por modelagem comercial aprovada | Item→variante, `variant.model`, `product_type.id/name`, possível dicionário de equivalência | **Enriquecimento + validação semântica** | `model` pode não representar a taxonomia comercial pretendida. Não usar tipo de produto como substituto silencioso. Manter valor bruto e categoria normalizada versionada |
| Ranking por cor | Mesmas somas por cor normalizada | Item→variante, `color`, `hex_color` | **Enriquecimento necessário**, campos documentados | Nulos e nomes diferentes/cores semelhantes exigem dicionário; hex não deve fundir cores sozinho. Preservar “não identificada” e conferir somas |
| Produtos comprados juntos | Em N pedidos elegíveis, `N_AB=count pedidos com A e B`; `support=N_AB/N`; `confidence(A→B)=N_AB/N_A` | Pedido ID, itens de q_i>0, vínculo de produto | **Calculável com dados atuais**, exige novo cálculo/endpoint/UI, não nova API da INK | Deduplicar produto dentro da cesta; duas unidades não são duas cestas; par não direcionado contado uma vez; A→B é direcional. N inclui todas as cestas elegíveis, também as parcialmente não associadas; publicar cobertura e não contar “desconhecido” como produto |
| Afinidade entre estampas | `lift(A,B)=(N_AB/N)/[(N_A/N)(N_B/N)]`, além de suporte e confiança | Cestas + vínculo produto→cluster validado | **Após enriquecimento de estampas** | Deduplicar cluster na cesta; não criar A=A quando diferentes peças têm mesma estampa. Baixa amostra gera lift alto espúrio. Denominador zero → null; associação não é causalidade |
| Desempenho por variante | `Σ r_i`, `Σ q_i`, pedidos distintos por `(produto,variante)` | `sourceVariantId`, variantes.id e associação com produto; metadata para rótulo completo | **Parcial hoje** por ID validado; **enriquecimento** para cor/modelo/tamanho | Produto associado não implica variante associada. Fallback SKU deve ser unívoco na variante do produto; caso contrário, variante desconhecida. Não usar `variant.sales_count` acumulado como substituto do período |
| Oportunidades para kits | Lista explicável de pares com N_AB, suporte, confiança, lift e cobertura; ordenar por frequência conjunta e filtrar afinidade com limiares aprovados | Cestas por produto/estampa e metadata opcional de catálogo | **Candidatos por produto calculáveis hoje**; kits por estampa após clusters | Proposta exploratória, não criação de kit ou previsão de incremento. Não define preço/desconto, margem ou estoque. `available_quantity/is_available` opcionais não garantem viabilidade operacional futura |
| Evolução de vendas por produto | Para produto p e dia/mês t: `R(p,t)=Σ r_i`, `Q(p,t)=Σ q_i`, pedidos distintos; comparação de intervalos equivalentes | Dia, pedido, itens, vínculo de produto, receita rateada existente | **Calculável hoje**, sem novo dado externo | Série atual é só global. Necessários agregação por produto, zeros explícitos e drill-down. Comparar meses parciais com mesma cobertura, não com mês cheio; histórico usa estado e catálogo atuais |

Conferência obrigatória: rankings completos por uma dimensão mutuamente exclusiva, **incluindo desconhecidos**, devem fechar com receita de itens e unidades do MVP no mesmo recorte. Não somar contagens de pedidos entre categorias como se fossem pedidos únicos; um pedido pode conter várias categorias. Para cestas, itens gratuitos puros não geram presença de compra; isso não autoriza alterar o rateio financeiro homologado.

Proposta para a exploração inicial: mostrar contagem conjunta ao lado de qualquer lift; limiar mínimo de pares, por exemplo N_AB≥5, e mínimo de suporte configurados/aprovados antes de recomendar kits. Os limiares são critérios de evidência, não regras financeiras. Nenhuma sugestão deve aparecer como “aumentará vendas” sem experimento posterior.

## 8. Arquitetura recomendada e custo

### 8.1 Caminho mínimo

Preservar o monólito Fastify servindo o React, o PostgreSQL privado e os módulos atuais de integração/domínio/persistência. **Não introduzir microserviços, Redis, warehouse externo, IA, motor de recomendação pago, cron de keep-alive ou Supabase Auth nesta fase.**

Fluxo proposto, ainda não implementado:

`INK GET documentado → validação/normalização mínima → snapshot transacional PostgreSQL → classify/allocate homologados → projeção BI → agregações → endpoints autenticados → React`.

- Novos KPIs reutilizam `classify`, `allocate`, `sum` e regras de datas. Não reimplementar uma segunda definição de venda paga em SQL nem copiar a lógica para o frontend.
- Projeção analítica de leitura deve consumir o mesmo snapshot/versão de pedidos e reembolsos. Preferir adaptação compartilhada, com regressão byte a byte das saídas existentes antes de qualquer refatoração interna.
- Inicialmente, cestas e séries por produto podem usar os JSONB atuais e funções puras no backend, sem migração. Recorrência/RFM precisam carregar história até D, não só os dois períodos já lidos pelo dashboard.
- Campos novos ficam em tabelas de extensão; manter contratos do MVP e respostas atuais estáveis. Não editar a migração 001 homologada; qualquer mudança futura deve ser aditiva e versionada.

### 8.2 Persistência adicional proposta, somente após aprovação

Os nomes abaixo são **propostas locais de banco**, não campos/endpoints da Reserva INK.

| Proposta | Conteúdo mínimo / chave | Motivo |
| --- | --- | --- |
| `bi_order_context` | `order_id` PK/FK para orders; `customer_key` nullable; método/versão de identidade; `created_at_source` timestamp completo; `source_run_id` | Não alterar o JSON financeiro existente; vínculo pseudônimo e ordenação histórica após backfill |
| `bi_product_attributes` | `product_id` PK/FK para products; tipo de produto, cluster validado nullable, origem/versão da classificação, `source_run_id` | Persistir dimensão necessária, sem descrição/mídia desnecessárias |
| `bi_variant_attributes` | Chave composta `(product_id, variant_id)`; SKU, cor, hex, tamanho, model brutos e normalizados, `source_run_id` | Permitir análise por variante sem assumir unicidade global de SKU ou inferir dimensões por nome |
| `bi_design_groups` | `cluster_id` PK; produto de vitrine, membros documentados e timestamps de origem; referência de versão | Rastrear o agrupamento de estampa e conferir membros contra o catálogo; um formato JSONB enxuto é suficiente inicialmente |

Não é necessário começar por tabela de clientes com nome/email/documento. Perfis RFM podem ser agregados por `customer_key` sem esses campos. Não é necessário duplicar todos os itens financeiramente numa nova fact table no primeiro incremento: arrays atuais podem ser projetados em leitura, por exemplo com LATERAL/ordinalidade para navegação, mantendo cálculo monetário no domínio. A posição do array é transitória, não chave imutável.

Se benchmarks justificarem, acrescentar posteriormente fatos derivados por pedido/item e agregados diários/mensais. Eles devem guardar versão da regra e do snapshot, ser reconstruíveis e nunca virar uma fonte financeira independente. Para auditoria de eventos por item, reter futuramente o `items[].id` documentado em extensão técnica; não inventar identidade pela posição.

### 8.3 Identidade e privacidade

Ordem de preferência para a decisão P0:

1. Chave técnica estável, se confirmada pela INK com evidência e cobertura histórica, namespace por loja e política para mudanças/fusões.
2. Se a chave não existir, aprovar processamento mínimo em memória de um identificador de `buyer` e persistir apenas `HMAC-SHA256(chave_secreta, namespace+identificador_normalizado)`. Usar chave própria do backend, versionada, sem registrá-la ou reutilizar token INK/hash de login.
3. Email é candidato, não certeza de pessoa única; normalização aprovada e conservadora, sem remover pontos ou sufixos “+”. Não fazer junções por nome. Documento como alternativa exigiria necessidade/qualidade e aprovação específica; não ativar fallback silencioso entre fontes.
4. Ausente, inválido ou conflitante → sem identidade validada. Não criar um novo cliente usando order.id. Mudança de chave/normalização exige estratégia de rotação e releitura, sem misturar populações.

HMAC é **pseudonimização**, não anonimização: esses dados continuam exigindo proteção, finalidade, retenção e controle de acesso. Não retornar nomes, emails, documentos nem a chave pseudônima por padrão nas APIs agregadas. A inspeção futura de qualidade deve retornar contagens/coberturas, não amostras identificáveis. Nenhuma dessas mudanças de coleta está autorizada pela simples existência deste relatório.

### 8.4 Consistência, histórico e operação Free

- Usar namespace de desenvolvimento e banco de teste isolado; branch Git não isola banco. Preferir PostgreSQL local de testes; se usar Supabase compartilhado, schema explicitamente separado e nenhuma migração contra o schema de produção. Não colocar a branch Fase 2 no serviço de produção.
- Reusar TLS verificado, pool pequeno (atualmente até 3 conexões por processo), consultas parametrizadas e schema privado. Endpoints BI devem herdar autenticação, origem, cache no-store para dados e proteção contra acesso anônimo.
- Não manter transação/conexão aberta durante a coleta da INK. Enriquecimento só é publicado com versão coerente de pedidos/catálogo/clusters. Se dimensões ficarem incompletas, não misturar cargas silenciosamente: preservar versão anterior e sinalizar ou publicar incompletude explícita por dimensão.
- IDs de grupos e variantes precisam de conferência de duplicações/conflitos. Dimensões não preenchidas não podem contaminar um bucket válido.
- Primeira implementação classifica o histórico pelo catálogo disponível, rotulando isso na UI. Se o negócio exigir dimensão “como vendida”, acrescentar vigência/snapshot de dimensões para novas cargas; dados antigos não são reconstruídos por suposição. Não iniciar um SCD completo sem essa necessidade.
- Render Free pode suspender/reiniciar; sincronização atual é trabalho no processo web, sem checkpoint de retomada de páginas. Última carga concluída permanece no PostgreSQL; restart retoma uma nova carga após a concessão expirar. Coleta adicional aumenta tempo e risco. Não prometer execução contínua nem usar polling artificial para contornar o plano.
- Supabase Free tem limites de espaço, conexões e tráfego e pode pausar por inatividade. Evitar respostas brutas/PII, índices GIN indiscriminados, snapshots de cada consulta e produto cartesiano de pares. Confirmar cotas atuais no painel; não há novo orçamento ou preço assumido neste parecer.

### 8.5 Performance e novas consultas

| Trabalho | Solução inicial | Gatilho para evolução |
| --- | --- | --- |
| Séries/rankings por produto | Uma passagem nos pedidos filtrados, reutilizando classificação e rateio; cache por versão/período/produto | Medir custo de transferir JSONB e CPU antes de materializar |
| Clientes e RFM | Projeção de pedidos identificados até D, chaves compactas e agregação por cliente; índices futuros em `customer_key`, `order_id` e timestamp | Se leitura histórica repetida exceder orçamento, fatos derivados e agregados por cliente/mês, reconstruídos por snapshot |
| Coortes | Primeira compra global observada e conjuntos de clientes distintos por mês; nunca gerar uma consulta por cliente | Pré-agregação mensal se necessário; persistir contagens, não listas identificáveis para o frontend |
| Cestas | Set por pedido, pares não direcionados; custo aproximadamente Σ k_p(k_p−1)/2 para k_p produtos distintos | Limitar universo candidato por ranking e manter denominador N original; informar filtros e cobertura. Cestas grandes precisam de tratamento explícito, sem exclusão silenciosa |
| Estampas/cor/modelo | Enriquecer dimensões no mesmo ciclo, usar joins/chaves locais e grupos desconhecidos | Índices compostos dos joins e filtros realmente usados; evitar uma chamada INK por item |

O cache deve incluir versão da carga, corte, janela, dimensões, filtros e versão da regra/identidade; manter cardinalidade limitada e invalidar após nova carga ou remapeamento. O cache atual é por processo e some na suspensão; PostgreSQL continua a fonte. Considerar cache derivado em PostgreSQL só após medição, sem novo serviço.

Metas de aceite **propostas, não medições**: ensaio com dados sintéticos de 5 mil, 20 mil e 50 mil pedidos; consultas usuais aquecidas com p95≤2 s no cenário de 20 mil, sem ultrapassar pool/timeout e com pico de memória abaixo do limite efetivo do plano. Registrar leitura fria separada; cold start do Render não entra no mesmo SLA. Se a meta falhar, medir payload, SQL e CPU e priorizar uma projeção compacta/agregação local antes de novas telas ou troca de infraestrutura.

## 9. Entregas incrementais propostas

Cada entrega inclui backend, frontend, testes e aceite. Todas permanecem em `develop/phase-2`; promoção para `main`, migração de produção e deploy dependem de aprovação posterior. Clientes e produtos não devem bloquear mutuamente entregas independentes.

| Entrega | Backend / dados | Frontend | Testes e critérios de aceite |
| --- | --- | --- | --- |
| E0 — Definições e qualidade | Aprovar E(P), identidade, cobertura temporal, cortes RFM/coortes, dimensões e desconhecidos; diagnóstico agregado autorizado para campos/chaves, sem persistir PII bruta | Especificar fluxos/wireframes para Clientes, Produtos e Qualidade, sem construir telas ainda | Baseline golden do MVP; amostra autorizada valida unicidade e joins; relatório de cobertura por campo. Sem identidade aprovada, KPIs de clientes ficam bloqueados, não aproximados |
| E1 — Produtos sobre dados atuais | Funções puras para evolução por produto e pares de cestas; endpoints autenticados próprios, separados do contrato atual | Drill-down temporal, tabela de combinações com N/suporte, filtros e explicação de cobertura | Totais por produto+desconhecidos fecham exatamente; duplicidade na cesta não duplica par; null para denominador zero; teste responsivo e 401; sem novas chamadas INK por navegação |
| E2 — Dimensões do catálogo | Migração aditiva das extensões; parser de variantes/cluster; leitura paginada de clusters; tipos apenas se necessários; versionar mapeamentos | Filtros/rankings por cor/modelagem/estampa e identificação dos não associados | Confrontar clusters versus membros, IDs conflitantes, nulls e variantes removidas. Todos os buckets fecham com receita/unidades MVP; rótulos comerciais aprovados; snapshot consistente e rollback |
| E3 — Base de clientes | Identidade validada/pseudonimização aprovada, timestamp completo, backfill histórico limitado e auditável; novos/recorrentes, frequência, ticket/acumulado | Visão agregada de clientes, janela e cobertura; nenhuma lista de PII necessária | Sem identidade não vira novo; primeira/segunda compra no mesmo período; antes do filtro; mesmo dia; alteração de identidade; cancelamentos/reembolsos. Valores identificados+desconhecidos fecham com MVP; nenhuma PII em API/log/fixtures reais |
| E4 — RFM e coortes | Funções determinísticas por D/L/W, cortes versionados, maturação e retenção mensal; caches limitados | Segmentos explicáveis, distribuição, matriz de coortes com células imaturas distintas de zero | Empates, amostra pequena, F/M zero, compradores inativos, corte histórico, fuso/virada de mês, coortes incompletas e ausência de histórico anterior. Resultados reproduzíveis na mesma versão |
| E5 — Afinidade e kits candidatos | Cestas por cluster, suporte/confiança/lift e limiares de evidência; nenhum preço/kit criado na INK | Recomendações com contagens, motivo, cobertura e limites; produto e estampa claramente distintos | Fórmulas em cestas sintéticas conhecidas, A→B versus B→A, A=A excluído, amostra rara, nulos e filtros. Sem promessa causal, margem ou disponibilidade não comprovada |
| E6 — Homologação e preparação de promoção | Benchmark, backup/restore de teste, migrações aditivas reversíveis por versão da aplicação, comparação com baseline e revisão de permissões | Revisão de usabilidade, performance, textos de metodologia e estados vazios/incompletos | Testes unitários/integração/E2E e build; valores MVP idênticos no mesmo dataset; validação autorizada com agregados reais; aprovação explícita antes de promover/deployar |

Sugestões de contratos de saída, **a definir e implementar só depois**: respostas BI agregadas com `period`, `cutoff`, `snapshotVersion`, `ruleVersion`, `identityCoverage`, `dimensionCoverage`, `unknownCounts`, `methodology` e dados do indicador. São metadados locais propostos, não campos da INK. Não alterar `/api/dashboard` para conter dados pessoais ou tornar a nova camada obrigatória para o MVP funcionar.

### Testes de regressão e qualidade mínimos

- Preservar integralmente saídas homologadas de classificação, totais, ticket, unidades, ranking, conciliação, comparação e arredondamento em fixtures sintéticas versionadas.
- Cobrir centavos residuais, descontos, frete, gratuito, troca, reembolso parcial/pendente, status português/inglês/desconhecido, histórico ausente e pedido desaparecido da origem.
- Identidade: nulo, identificador inválido/compartilhado, conflito, normalização/rotação de chave, duas compras no mesmo dia, histórico truncado. Não unir nomes semelhantes.
- Dimensões: produto conhecido/variante desconhecida, SKU ambíguo, IDs conflitantes, cluster ausente ou inconsistente, alteração de classificação, produto/variante removidos e personalização.
- Estatística: pares deduplicados, suporte/confiança/lift com denominadores explícitos, coortes maduras/imaturas, recência/frequência e empates de RFM.
- Integração PostgreSQL: migração nova idempotente, startup concorrente, leitura consistente, rollback, publicação por versão e concessão perdida. Testar retomada do serviço sem assumir retomada de página da INK.
- Integração INK simulada: paginação por recurso, escopos insuficientes, falha parcial, 429/Retry-After e coleção alterada durante leitura. Não usar produção como ambiente de testes automatizados.
- Segurança: 401 sem sessão, ausência de PII/segredos em respostas/logs/artefatos, minimização no banco e preservação das políticas atuais.

## 10. Riscos, dependências e decisões pendentes

| Prioridade | Risco / dependência | Consequência | Mitigação / decisão necessária |
| --- | --- | --- | --- |
| Crítica | Cliente sem ID documentado, buyer descartado | KPIs de clientes inviáveis hoje; risco de junção falsa | Confirmar chave técnica ou aprovar identificador mínimo/HMAC e suas limitações antes de E3 |
| Crítica | Mudança involuntária da definição financeira | Quebra da homologação | Reutilizar funções do domínio e comparar golden baseline; nenhuma exclusão/receita nova nesta fase |
| Alta | Histórico incompleto/left censoring | Falsos novos clientes, recência e retenção enviesadas | Releitura histórica autorizada, cobertura e rótulo “observado”; não afirmar completude pela menor data presente |
| Alta | Catálogo atual e grupos incompletos/mutáveis | Ranking por estampa/modelagem com atribuição errada | Conferência de IDs, desconhecidos, mapeamentos versionados e escolha explícita entre classificação atual e histórica |
| Alta | Personalização de arte por comprador | Produto/cluster pode não representar a arte vendida | Manter exceções explícitas; não baixar imagens nem tratar URL como chave de estampa |
| Alta | Pseudônimo tratado como dado anônimo | Coleta excessiva e exposição | Aprovação de finalidade/retenção, HMAC com chave própria, acesso restrito e agregação sem PII |
| Alta | Render suspende durante carga maior | Enriquecimento incompleto ou indisponível | Snapshot anterior preservado, versão/cobertura explícitas, retry controlado; avaliar checkpoint somente como entrega futura separada |
| Média | CPU, memória, tráfego e pares combinatórios | Lentidão/cota Free excedida | Benchmark sintético, pool pequeno, cache limitado, projeção compacta, top candidatos com denominador íntegro |
| Média | Observação antiga de `.id` em objetos opacos | Contrato externo pode mudar | Adaptador defensivo, validação contra catálogo e métricas de associação; não transformar observação em garantia |
| Média | Token/plano sem escopo adicional | Catálogo auxiliar indisponível | Validar somente recursos mínimos; clientes/tipos/trocas/promoções não são pré-requisitos automáticos de tudo |
| Média | Branch de desenvolvimento usando banco de produção | Migração/teste afeta MVP | Separar variáveis e banco/schema; não iniciar aplicação nem migrar produção nesta etapa |
| Média | Baixa amostra e coortes imaturas | Recomendação enganosa | Contagens, limiares aprovados, null/incompleto e distinção de correlação/causalidade |

Decisões para aprovação:

1. Aceitar a ordem E0→E1/E2 e frente de identidade em paralelo, com bloqueio explícito de clientes até resolver a chave.
2. Aprovar método de identidade e tratamento de casos desconhecidos/ambíguos; escopos e releitura mínima necessários.
3. Aprovar uso inicial de cluster como estampa validada e dicionário de modelagem/cor, com grupos desconhecidos e classificação atual declarada.
4. Aprovar janela de recompra W, janela RFM L, cortes/empates e uso de primeira compra observada/coortes maduras.
5. Aprovar limiares de evidência para pares/kits e critérios propostos de desempenho/cobertura.
6. Manter regras financeiras do MVP e ausência de faturamento líquido definitivo; não incluir margem, atribuição de marketing ou previsão como se fossem deriváveis desses dados.

## 11. Inventário completo de caminhos da API externa

O OpenAPI local contém **35 caminhos e 27 operações GET**. A tabela a seguir inventaria todos os caminhos e métodos, incluindo operações de escrita **somente como documentação**. Nenhuma foi executada ou proposta para a sincronização analítica. Detalhes por ID, recursos financeiros auxiliares, carrinhos/leads e operações de escrita não estão integrados ao runtime atual salvo os três GET já identificados.

| Caminho | Métodos documentados | Uso atual / avaliação |
| --- | --- | --- |
| `/v1/stores/abandoned_carts` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/balance_extract` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/balance` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/collections/{collection_id}/custom_showcase` | GET, PUT | GET disponível no contrato; não integrado |
| `/v1/stores/collections` | GET, POST | GET disponível no contrato; não integrado |
| `/v1/stores/collections/{id}` | GET, PATCH, DELETE | GET disponível no contrato; não integrado |
| `/v1/stores/customers` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/customers/{id}` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/exchanges` | GET, POST | GET disponível no contrato; não integrado |
| `/v1/stores/exchanges/{id}` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/external_orders` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/external_orders/{id}` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/leads` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/orders/{order_id}/refunds` | GET, POST | GET integrado; eventuais métodos de escrita não usados |
| `/v1/stores/orders` | GET | GET integrado; eventuais métodos de escrita não usados |
| `/v1/stores/orders/{id}` | GET, PATCH | GET disponível no contrato; não integrado |
| `/v1/stores/prepayments` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/product_clusters/{product_cluster_id}/products/{id}` | DELETE | Somente escrita; fora da coleta analítica |
| `/v1/stores/product_clusters` | GET, POST | GET disponível no contrato; não integrado |
| `/v1/stores/product_clusters/{id}` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/product_types` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/product_types/{id}` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/products/{product_id}/copy` | POST | Somente escrita; fora da coleta analítica |
| `/v1/stores/products` | GET, POST | GET integrado; eventuais métodos de escrita não usados |
| `/v1/stores/products/{id}` | GET, PATCH | GET disponível no contrato; não integrado |
| `/v1/stores/promotions` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/promotions/standard` | POST | Somente escrita; fora da coleta analítica |
| `/v1/stores/promotions/progressive` | POST | Somente escrita; fora da coleta analítica |
| `/v1/stores/promotions/unit_free` | POST | Somente escrita; fora da coleta analítica |
| `/v1/stores/promotions/{id}` | GET, DELETE | GET disponível no contrato; não integrado |
| `/v1/stores/promotions/standard/{id}` | PATCH | Somente escrita; fora da coleta analítica |
| `/v1/stores/promotions/progressive/{id}` | PATCH | Somente escrita; fora da coleta analítica |
| `/v1/stores/promotions/unit_free/{id}` | PATCH | Somente escrita; fora da coleta analítica |
| `/v1/stores/shipping_simulation` | GET | GET disponível no contrato; não integrado |
| `/v1/stores/withdraws` | GET | GET disponível no contrato; não integrado |

## 12. Encerramento desta etapa

Entrega limitada a este relatório, em `develop/phase-2`. O roadmap e os arquivos de código permanecem inalterados; arquivos locais preexistentes fora deste escopo foram preservados. Nenhum commit, push, deploy, migração, sincronização ou acesso a dados reais foi necessário.

A validação desta etapa é documental: conferência do DDL, modelos/normalizadores, rotas ativas, OpenAPI, fórmulas e referências Git. Não foram executados testes da aplicação ou benchmark, pois não houve mudança de implementação; ensaios anteriores são apenas contexto. O início do desenvolvimento das entregas acima aguarda aprovação explícita do proprietário.
