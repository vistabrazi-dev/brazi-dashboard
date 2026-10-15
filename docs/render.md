# Supabase Free + Render Free — preparação sem deploy

A aplicação usa React + TypeScript servido pelo Fastify, na mesma origem HTTPS. Pedidos, produtos, reembolsos, execução da sincronização, sessões e limites de login ficam no PostgreSQL do Supabase. O Render usa **Free sem disco persistente**. Esta configuração não cria projetos nem executa deploy automaticamente por comandos locais.

## 1. Criar o banco no Supabase

1. Quando decidir implantar, crie um projeto no plano **Free**, escolhendo uma região próxima do Render. Guarde a senha do banco em um gerenciador de senhas.
2. Abra **Connect** no painel do projeto. Copie a conexão PostgreSQL do **Session pooler** (Supavisor, normalmente porta 5432), com host, banco e usuário exatos apresentados no painel. Não invente o host nem use a URL HTTP do projeto.
3. Substitua a senha somente no campo privado do ambiente; caracteres reservados na senha devem estar codificados para URL. Nunca cole a URL no GitHub, chat, screenshots ou logs.
4. Use `sslmode=verify-full` na URL (ou `require`, que esta aplicação também eleva para verificação completa do certificado). O driver sempre usa TLS com `rejectUnauthorized: true` para conexões remotas e em produção. Não use `no-verify`, não desligue validação TLS e não configure `NODE_TLS_REJECT_UNAUTHORIZED=0`.
5. Se a cadeia de certificados do banco não for reconhecida, obtenha a CA oficial do projeto no Supabase e informe seu PEM em `DATABASE_CA_CERT`. Preserve quebras de linha. Não baixe certificados de fontes não confiáveis nem altere o código para aceitar qualquer certificado.

A conexão direta do Supabase Free pode depender de IPv6. Se a rede do Render não a alcançar, use o pooler compartilhado com suporte IPv4, em vez de contratar IPv4 dedicado. Copie o endereço atual do painel. Se preferir o **Transaction pooler** (normalmente 6543), o código usa queries sem prepared statements nomeados, bloqueios somente transacionais e `SET LOCAL` dentro de transações; não depende de estado de sessão. O Session pooler é a opção inicial recomendada para este processo Node persistente.

Use a credencial PostgreSQL administrativa do projeto, que deve ser proprietária do schema criado pela aplicação. Não use `anon key`, `publishable key`, `service_role key` ou Supabase Auth como substitutos de `DATABASE_URL`. Nenhuma chave do Supabase vai ao frontend.

O schema padrão **brazi** é criado pelas migrações, com RLS nas tabelas e revogação de acesso de PUBLIC, anon e authenticated. Não o adicione aos schemas expostos pela Data API. O backend acessa as tabelas como proprietário, sem políticas públicas. Se adotar um usuário de runtime com privilégios menores futuramente, será necessário planejar grants e políticas específicas; esta versão executa migrações com o próprio usuário configurado.

## 2. Configurar o Render Free, quando autorizar o deploy

O `render.yaml` deve ficar na raiz do repositório. Aplicar um Blueprint pode iniciar o primeiro deploy; `autoDeploy: false` desativa deploys posteriores por commits, não a primeira implantação. Não aplique apenas para simular.

| Campo | Valor |
| --- | --- |
| Tipo / plano | Web Service Node / **Free** |
| Instâncias | Uma |
| Build | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start | `npm start` |
| Node | 24.x |
| Health check | `/health` |
| Disco | Nenhum |

O React compilado é servido pelo próprio Fastify, sem Vite em produção. `PORT` vem do Render; o backend usa `0.0.0.0`. Não é necessário criar Static Site separado nem configurar CORS entre serviços. O build não abre o PostgreSQL. Não é necessário pre-deploy command, que pode ter restrições no plano Free: as migrações rodam no startup, antes de abrir a porta.

Configure no painel **Environment** do Render:

| Variável | Valor / origem |
| --- | --- |
| `DATABASE_URL` | URL privada do pooler Supabase com TLS; obrigatória |
| `DATABASE_POOL_MAX` | `3` no Blueprint; reduza para `1` se necessário |
| `NODE_ENV` | `production` |
| `AUTH_ENABLED` | `true`; produção recusa desabilitar |
| `AUTH_USERNAME` | Usuário administrativo privado |
| `AUTH_PASSWORD_HASH` | Hash gerado pelo comando abaixo |
| `RESERVA_INK_TOKEN` | Token com store.orders.read, store.products.read e store.refunds.read |
| `BUSINESS_TIMEZONE` | `America/Sao_Paulo` |
| `API_PAUSE_MS` | `1800`, mínimo 1500 |
| `SYNC_MAX_PAGES` | `1000` |
| `APP_ORIGIN` | Opcional no domínio padrão; origem HTTPS exata para domínio próprio |
| `DATABASE_CA_CERT` | Opcional, CA oficial em PEM se necessária |
| `DISPLAY_CURRENCY` | Opcional; apenas após confirmar moeda/unidade da INK |

`DATABASE_SCHEMA` é opcional, padrão `brazi`. Alterá-lo aponta para outro conjunto de tabelas, não renomeia nem migra dados existentes. Em produção, arquivos `.env` não são carregados: DATABASE_URL e demais credenciais vêm exclusivamente do ambiente do processo. Arquivos `.env` são aceitos apenas no desenvolvimento/testes. Não configure `DATABASE_PATH`: não há SQLite no runtime. Segredos com `sync: false` serão informados fora do YAML. Segredos de GitHub Actions ou deste ambiente não são copiados automaticamente para o Render.

A origem vem de `APP_ORIGIN` ou `RENDER_EXTERNAL_URL`, fornecida pelo Render. Domínio próprio deve ser configurado com certificado HTTPS válido antes de usá-lo como origem. O Node confia somente no proxy imediato do Render. Não exponha sua porta diretamente nem aceite cabeçalhos de outro proxy não confiável.

## 3. Criar a credencial de login

Em terminal confiável com Node 24 e o projeto:

```sh
npm ci
npm run build
npm run auth:password
```

Informe uma senha longa e única (12–256 caracteres), com confirmação e entrada oculta. Copie somente o hash produzido para `AUTH_PASSWORD_HASH` no ambiente do Render; preserve os caracteres `$`. Não salve senha ou hash no repositório, chat ou histórico de comandos.

São preservados scrypt com salt aleatório, limite de duas derivações simultâneas, sessões opacas de oito horas e armazenamento somente do SHA-256 do token. Cookies de produção usam `__Host-`, Secure, HttpOnly, SameSite=Strict, Path=/ e nenhum Domain. Logout e expiração revogam o acesso; trocar usuário/hash invalida sessões anteriores. As sessões sobrevivem a reinícios/deploys se PostgreSQL, origem e credenciais forem mantidos.

Login tem limite persistente de dez tentativas por IP derivado e 60 globais por 15 minutos, consumido em transação para evitar corridas. Login, logout e sincronização exigem JSON, cabeçalho de segurança e origem exata. Todas as APIs comerciais exigem autenticação; `/health` público retorna apenas estado mínimo. Não há senha no navegador após login, localStorage, cadastro público, MFA ou recuperação automática de senha.

## 4. Migrações e primeira carga

A migração `src/storage/migrations/001-initial.ts` cria schema, tabelas JSONB normalizadas, índices, sessões e controle de execuções/tentativas. O registro `schema_migrations` impede reaplicação. Um bloqueio transacional coordena startups concorrentes; DDL e registro da versão são atômicos. Banco com versão desconhecida mais recente é recusado. Não há downgrade automático.

O servidor aplica migrações antes de atender requisições. Também é possível executá-las em uma máquina confiável:

```sh
npm run migrate
# Após build, inclusive sem dependências de desenvolvimento:
npm run migrate:prod
```

Esses comandos exigem DATABASE_URL; em produção TLS é obrigatório. Não há retry infinito no startup. Banco pausado, CA inválida, credencial incorreta ou rede bloqueada fazem o processo falhar com mensagem sem segredos. Retome/corrija o banco e reinicie o serviço.

Para um banco novo, faça login e clique **Atualizar dados**. A carga lê a API integralmente, respeitando paginação, pausas e HTTP 429. Grava lotes de até 500 registros dentro de uma única transação; UPSERT não duplica IDs. Leituras do dashboard usam uma transação de snapshot consistente para combinar versão, pedidos, produtos e reembolsos. Cache é invalidado pela versão da última carga concluída. Regras financeiras e cálculos exatos em centavos permanecem no módulo de domínio.

O pool Node tem no máximo três conexões por processo, timeout de conexão de dez segundos e conexões ociosas liberadas após dez segundos. Queries em transações têm limite de 30 segundos por instrução; o cliente também limita a espera. Não há transação nem conexão reservada durante toda a coleta da API. As concessões são persistidas e recebem heartbeat; após dois minutos sem heartbeat podem ser substituídas por outra carga. A publicação verifica a propriedade da concessão. Sessões e limite de tentativas também ficam no PostgreSQL, não na memória do Render.

## 5. Importar o SQLite anterior (opcional e privado)

Não copie o arquivo para Git ou imagem do Render. A aplicação nova não modifica nem apaga o SQLite antigo. Para preservar pedidos históricos ausentes da API, use a ferramenta local de transição antes da primeira sincronização no destino:

1. Pare a aplicação antiga e faça backup consistente privado do SQLite (incluindo WAL/SHM quando aplicável). Trabalhe em uma máquina confiável com acesso à cópia e ao PostgreSQL.
2. Configure `.env` privado com DATABASE_URL do destino e `SQLITE_IMPORT_PATH` apontando para a cópia. Use as demais variáveis exigidas de autenticação se NODE_ENV=production.
3. Execute `npm run import:sqlite`. O destino comercial deve estar vazio, sem carga concluída. Não execute a nova sincronização antes da importação.
4. A ferramenta abre a origem somente para leitura, valida os modelos normalizados estritamente, importa pedidos/produtos/reembolsos/fuso em uma transação e rejeita campos extras. Não importa sessões, tentativas ou credenciais: faça novo login.
5. Confira privadamente os indicadores e conserve o backup. Uma segunda importação em destino preenchido é recusada. Depois, sincronize normalmente para atualizar o estado da INK.

O comando requer as dependências de desenvolvimento (tsx); rode na máquina confiável, não no Shell do serviço Free. Uma nova sincronização sem importar também é possível, mas não recupera registros históricos que já não existem na API. **Nenhuma base real foi transferida nesta adaptação.**

## 6. Limitações dos planos gratuitos

- **Render Free:** há suspensão por inatividade (a regra usual é cerca de 15 minutos sem tráfego recebido) e partida a frio, que pode levar um minuto ou mais. Horas gratuitas são compartilhadas pelos serviços do workspace; exceder cotas pode suspender o serviço. Não há disco persistente, garantia de execução contínua, Shell ou job dedicado pressuposto por este projeto.
- **Sincronização:** é um trabalho no processo web, não uma fila durável com checkpoint. Mantenha o dashboard aberto para acompanhar, mas isso não garante conclusão. Suspensão, redeploy ou reinício podem interromper a coleta. A última carga concluída fica intacta no Supabase; depois de expirar a concessão, execute novamente desde o início. Não foram adicionados pings artificiais para impedir suspensão.
- **Supabase Free:** projetos podem ser pausados por baixa atividade (a referência usual é uma semana). Pode ser necessário restaurar/retomar no painel antes de o backend conectar. O plano tem limites de banco, tráfego e conexões; a referência usual de banco é 500 MB por projeto, mas confira o painel e termos atuais. Não presuma disponibilidade contínua ou backup/PITR incluído.
- **Conexões:** o pool local pequeno não elimina o limite global do Supabase; cada processo ou ferramenta adiciona conexões. Prefira uma instância, feche ferramentas ociosas e reduza DATABASE_POOL_MAX se necessário. Use pooler IPv4 quando conexão direta IPv6 não funcionar. Endereços e certificados devem ser os fornecidos pelo painel, nunca presumidos.
- **Crescimento:** JSONB guarda somente dados comerciais normalizados. Runs/tentativas/sessões também consomem espaço; sessões e tentativas vencidas são limpas durante login. Monitore tamanho, tráfego e histórico de execuções. Crescimento sem limite exigirá retenção administrativa ou plano maior; não há rotina automática de apagar pedidos.
- **Backup:** faça exportações PostgreSQL privadas e teste restauração. Persistir fora do Render não protege de exclusão do projeto, erro operacional ou indisponibilidade do provedor. Não presuma que o plano Free inclui recuperação pontual.

Esses limites podem mudar. Consulte as fontes atuais antes de ativar: [Render Free](https://render.com/docs/free), [Blueprint](https://render.com/docs/blueprint-spec), [Supabase Pricing](https://supabase.com/pricing), [Conexões e pooler](https://supabase.com/docs/guides/database/connecting-to-postgres), [SSL](https://supabase.com/docs/guides/platform/ssl-enforcement), [Backups](https://supabase.com/docs/guides/platform/backups).

## 7. Testar sem dados reais

Use PostgreSQL local com banco exclusivo cujo nome termine em `_test`. Configure TEST_DATABASE_URL no `.env` ou ambiente; os testes recusam host remoto ou nome sem esse sufixo. Nunca aponte para o projeto comercial. Para PostgreSQL local sem TLS, use host loopback e `sslmode=disable`, somente fora de produção.

```sh
npm ci
npm test
npm run build
npm run test:e2e
```

Cada teste cria/remove seu schema isolado. E2E requer Chromium e usa token INK desabilitado, credencial aleatória e dados fictícios. O build não exige banco nem credenciais. A execução dos testes de integração exige banco real disponível; não são substituídos por mocks de SQL ou ignorados silenciosamente.

Após um futuro deploy autorizado, confira certificado HTTPS, bloqueio 401 sem login, login/logout, cookies seguros, migrações, sincronização e persistência após restart. Conectividade específica do Supabase, aceitação do Blueprint e comportamento de suspensão precisam de validação no serviço real; os testes locais não os comprovam.

## Diagnosticar falha durante npm start

A inicialização registra somente etapa, código reconhecido e orientação estática. Não registra URL, hostname real, usuário do banco, senha, hash, token, SQL, resposta do pooler ou stack. Erros desconhecidos são apresentados como NAO_CLASSIFICADO. A configuração pode informar nomes de variáveis inválidas, nunca seus valores.

Exemplo seguro:

```text
[Brazi startup] etapa=conexão PostgreSQL; diagnóstico=SELF_SIGNED_CERT_IN_CHAIN; Cadeia TLS não confiável. Configure a CA oficial em DATABASE_CA_CERT; não desative a verificação.
```

| Etapa / diagnóstico | Verificação |
| --- | --- |
| configuração | Variáveis obrigatórias, formatos, origem HTTPS, fuso e moeda |
| conexão / ENOTFOUND ou EAI_AGAIN | Host exato do Session Pooler e DNS |
| conexão / ENETUNREACH, ECONNREFUSED ou ETIMEDOUT | Pooler IPv4, porta, restrições de rede e projeto Supabase ativo |
| conexão / erro TLS | CA oficial em DATABASE_CA_CERT e hostname correto; nunca desligar verificação |
| conexão / 28P01 ou 28000 | Usuário do pooler, senha e codificação de caracteres reservados na URL |
| conexão / 53300, 57P03 ou XX000 | Limite de conexões, projeto pausado/retomando, usuário e endpoint do pooler |
| migrações / 42501 | Propriedade do schema e permissões para criar/revogar grants |
| migrações / BRAZI_DB_VERSION, 42P07 ou 42P01 | Versão da aplicação e histórico do schema; não apagar dados para contornar |
| abertura da porta HTTP / EADDRINUSE ou EACCES | PORT do Render e conflito de processos |

A mensagem genérica das versões anteriores não permite concluir qual dessas causas ocorreu. A nova saída identifica a etapa efetivamente alcançada. Falha continua encerrando o processo com código não zero, sem desabilitar TLS ou autenticação. Conexões são fechadas quando a preparação HTTP ou abertura da porta falha. Migrações continuam transacionais e não iniciam sincronização da INK.
