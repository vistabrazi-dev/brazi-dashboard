# E1 — G2: proteções, ferramentas de snapshot e evidências

Data: 19/10/2026. Branch exclusiva: `develop/phase-2`.
Escopo executado: preparação técnica e testes **somente em PostgreSQL 17 local, com dados sintéticos**. Sem recursos Render/Supabase, banco comercial, alteração de credenciais/permissões de produção, cópia real ou deploy. G3 continua sujeito a autorização própria.

Complementa o [runbook G1](phase-2-e1-staging-runbook.md) e o [plano de homologação](phase-2-e1-staging-homologation-plan.md). As limitações do G1 sobre inexistência de ferramentas/preflight e hard-block foram resolvidas pela entrega abaixo; as dependências de acesso real/RLS e capacidade dos provedores permanecem pendentes de verificação operacional.

## 1. Bloqueio explícito de INK

Configuração obrigatória no futuro serviço isolado:

```dotenv
BRAZI_ENV=staging
INK_SYNC_DISABLED=true
STAGING_POLICY_PATH=/caminho/privado/staging.staging-policy.json
DATABASE_SCHEMA=brazi_e1_staging
```

Não cadastrar token INK. Mesmo que um token seja incluído acidentalmente, `BRAZI_ENV=staging` bloqueia o início de SyncService **antes de adquirir/criar execução no banco**, o CLI sync antes de abrir Store, o cliente INK antes de fetch e o transporte utilizado pelos pedidos/produtos/reembolsos antes das requisições e de cada tentativa. A presença de `STAGING_POLICY_PATH` também ativa o modo protegido, mesmo que BRAZI_ENV seja omitido. `INK_SYNC_DISABLED=true` fornece bloqueio independente de rede INK para outros ambientes. Valores inválidos das flags são recusados.

A chamada autenticada de sincronização retorna `accepted:false`, com mensagem de política. O botão atual não altera as proteções. Nenhuma autenticação nem regra comercial foi trocada. Sem flags de staging/política, o comportamento normal do MVP permanece; regressão inclui sincronização sintética fora do staging.

Essas proteções cobrem os caminhos de aplicação/CLI existentes. Não são um firewall e não impedem um administrador de alterar código/retirar todas as flags e a política. Restringir edição das configurações e manter revisão dupla. Não há promessa de bloqueio de rede do plano Free.

## 2. Política e identidade do destino

O preflight ocorre antes de qualquer migração de `Store.open()` em staging, abrangendo servidor, CLI de migração e importador SQLite existentes. As ferramentas novas de migração/importação também sempre o exigem, sem depender de DATABASE_URL global. A identidade é conferida novamente na conexão que fará a migração/carga, antes de DDL/escritas comerciais.

São exigidos:

1. Endpoint completo permitido: host, porta, banco e usuário do pooler, sem senha na política.
2. Origem declarada diferente do destino. Para Supabase Session Pooler, a referência do projeto no usuário diferencia projetos que compartilham o mesmo hostname. Não basta mudar o usuário de um mesmo projeto/banco.
3. Schema de destino explícito `brazi_e1_staging` ou sufixo permitido, e schema de origem aprovado.
4. `current_database()` e `current_user` esperados no destino.
5. Uma única linha com UUID esperado em `brazi_staging_guard.identity`, existente **somente no projeto novo**.

Endpoints remotos de destino são limitados a Session Pooler Supabase na porta 5432; conexão de teste local é a exceção. TLS é verificado pelo driver existente; não desabilitar certificados. Não usar porta 6543 de transaction pooling para estas operações.

Exemplo de estrutura privada (preencher exclusivamente depois de autorização; placeholders não servem como identidade válida):

```json
{
  "version": 1,
  "source": {
    "host": "HOST_SESSION_POOLER_ORIGEM",
    "port": 5432,
    "database": "postgres",
    "user": "USUARIO_POOLER_COM_REF_ORIGEM"
  },
  "destination": {
    "host": "HOST_SESSION_POOLER_STAGING",
    "port": 5432,
    "database": "postgres",
    "user": "USUARIO_POOLER_COM_REF_STAGING"
  },
  "databaseRole": "PAPEL_POSTGRESQL_DESTINO",
  "sourceSchema": "SCHEMA_NORMALIZADO_ORIGEM",
  "schema": "brazi_e1_staging",
  "stagingId": "UUID_EXCLUSIVO_DO_DESTINO"
}
```

`user` é o login completo do pooler; `databaseRole` é o papel retornado por `current_user`, que pode não conter o sufixo de projeto. Confirmar ambos sem divulgar senha. A política fica fora do repositório; o marcador não é autocriado pelo preflight. Se estiver ausente/errado, a operação falha fechada.

### Bootstrap do marcador — procedimento futuro de G3

O destino novo precisa do marcador antes de a aplicação migrar. Essa ação manual é exceção de bootstrap **apenas no projeto independente previamente identificado no painel**, nunca na origem. Não há comando que adivinhe ou crie automaticamente sua identidade.

Após autorização G3, duas pessoas conferem referência do novo projeto, conexão e papel. No SQL Editor **do novo projeto**, o operador prepara schema `brazi_staging_guard` privado e tabela `identity` com uma única linha UUID:

- coluna `singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton)`;
- coluna `staging_id UUID NOT NULL`, com o UUID da política privada;
- revogar acesso de PUBLIC, anon e authenticated; manter schema fora dos schemas expostos à Data API;
- habilitar RLS; runtime deve conseguir apenas a leitura necessária, usando propriedade/política/permissão compatível com o papel exclusivo escolhido;
- não copiar o marcador ou criar essa tabela na produção.

O preflight só faz SELECT nessa tabela; não corrige marcador nem solicita privilégios automaticamente. O usuário de startup continua precisando de privilégios de migração **no staging**. A separação owner/migrador/runtime não foi implementada e não deve ser presumida.

## 3. Ferramentas e isolamento dos comandos

Disponíveis após `npm ci` no ambiente de operação e, para execução compilada, após `npm run build`:

```text
npm run staging -- key
npm run staging -- preflight
npm run staging -- migrate
npm run staging -- export
npm run staging -- import
```

Equivalente compilado: `npm run staging:prod -- AÇÃO`. Todas exigem `BRAZI_ENV=staging`. Não carregam `.env`, não usam `DATABASE_URL` como fallback e não recebem segredos por argumentos. Configurar valores privados pelo gerenciador de segredos/ambiente seguro do operador, sem colá-los no terminal, chat ou log. Não executar com tracing ou dump de ambiente.

| Variável | Uso |
| --- | --- |
| `STAGING_CODE_REVISION` | Export/import: SHA Git completo de 40 caracteres do código aprovado; importação exige igualdade com o manifesto do pacote |
| `STAGING_POLICY_PATH` | JSON privado de identidade descrito acima |
| `STAGING_SOURCE_URL` | Somente exportador: conexão autorizada à origem, independente da credencial do destino |
| `STAGING_SOURCE_SCHEMA` | Deve coincidir com `sourceSchema` da política |
| `STAGING_SOURCE_COUNTS_PATH` | JSON privado com contagens esperadas `orders`, `products`, `refunds`, obtidas de referência autorizada independente do leitor a verificar |
| `STAGING_DESTINATION_URL` | Preflight/migrate/import: somente projeto independente de staging |
| `STAGING_KEY_PATH` | Caminho privado para chave binária de 32 bytes; `key` cria com modo 0600 e recusa sobrescrita |
| `STAGING_SNAPSHOT_PATH` | Pacote AES-256-GCM; export cria modo 0600, sem sobrescrever arquivo existente |
| `STAGING_EXPECTED_SHA256` | Import: SHA-256 do pacote lógico fornecido pelo exportador e conferido por canal privado independente |
| `NODE_ENV` | `production` nas operações remotas; `test` somente no ensaio local com PostgreSQL sintético |
| `DATABASE_CA_CERT` | CA oficial, se necessária; nunca substituir validação TLS por conexão insegura |

Manter exportador e importador em contextos separados: exportador sem segredo de destino; importador/Render sem segredo da origem. A política tem apenas identidades não secretas, não URLs com senhas. Usar diretório privado fora do checkout; chaves, pacotes e política não devem ser publicados. `.gitignore` também cobre `*.brazi-snapshot`, `*.staging-key` e `*.staging-policy.json`.

### Exportação mínima

1. Resolver previamente a autorização de leitor/políticas RLS. Não criar papel/permissão na produção. Na ausência de leitor existente, avaliar a alternativa de operador já autorizado do G1, com aprovação explícita da exceção.
2. Preparar arquivo privado de contagens esperadas, por exemplo a estrutura `{"orders":16,"products":3,"refunds":1}` **somente como exemplo sintético**. Para dados reais, não inventar contagens nem derivá-las apenas da mesma consulta possivelmente filtrada por RLS. A referência precisa corresponder ao conjunto e corte autorizado; se não puder ser confirmada, bloquear exportação real.
3. Gerar chave com `key` no diretório privado. O comando não imprime chave. Transferi-la por canal seguro separado do pacote, com acesso mínimo; nunca versionar ou transmitir em logs.
4. Executar `export` somente na janela autorizada. O módulo não chama Store/migrate e usa uma conexão em `REPEATABLE READ READ ONLY`; todas as cinco tabelas são lidas na mesma transação, com timeout de consulta/ociosidade de 30s.
5. A allowlist estrutural estrita admite apenas o modelo comercial normalizado. Campos inesperados, códigos de issues desconhecidos e números que exigiriam arredondamento são recusados. Não normalizar novamente nem apagar anomalias para completar a exportação. Textos de erro de runs são substituídos por NULL.
6. Exportar runs referenciadas por `orders.seen`, último sucesso e última execução; manter IDs e `seen`. Execução ativa/interrompida, ausência de sucesso ou timezone inválido bloqueiam o pacote. Não parar sincronização de produção para obter corte.
7. Conferir contagens independentes. O pacote inclui SHA do código informado pelo operador, corte, schema, dados, controles financeiros/cobertura e hash lógico. O comando imprime apenas sucesso e SHA-256 para registro **privado**, sem pedidos, nomes ou valores. UUID, hash e arquivo são evidências de integridade operacional, não uma autorização de acesso.

A projeção lê somente colunas comerciais fixas, com JSON normalizado validado estritamente em memória; conteúdo inesperado não é escrito no pacote. Uma origem contendo JSON bruto ou dados pessoais deve bloquear a operação e ser revisada, nunca ser tratada como fonte elegível. Strings comerciais autorizadas ainda podem conter informações confidenciais.

### Importação atômica

1. Confirmar marker/política e executar `preflight`. Este comando não migra nada.
2. Executar `migrate` apenas após o preflight aceito no destino. A importação **não executa migrações implicitamente**. Migração do destino e carga comercial são operações distintas.
3. Receber pacote/chave separadamente e confirmar SHA-256 por canal privado. O importador exige criptografia autenticada, hash esperado, estrutura e controles recalculados antes de gravar dados.
4. Executar `import` com aplicação parada. Uma transação trava as sete tabelas de dados/autenticação, exige destino vazio e carrega apenas runs/products/orders/refunds/meta. Não faz upsert, DELETE ou TRUNCATE para contornar dados existentes.
5. IDs de runs usam `OVERRIDING SYSTEM VALUE`; identidade é reposicionada com `ALTER TABLE ... RESTART`, transacional, sem `setval`. Não são importados schema_migrations, sessões ou tentativas de login.
6. Antes do COMMIT, reler os dados, comparar digest por conteúdo e controles financeiros exatos. Em divergência/erro, ROLLBACK desfaz carga e reposicionamento da identidade. Reembolsos órfãos preexistentes são contados e preservados; novos desencontros ou perda de referência `seen` não são aceitos.
7. Após COMMIT, verificar novamente persistência por conexão obtida do pool. Se essa verificação falhar, o comando retorna erro, mas **a carga pode já estar confirmada**: manter serviço fechado, investigar e decidir recomposição autorizada. Não repetir com limpeza automática.
8. Destino não vazio implica recusa; nova tentativa exige decisão operacional explícita. Só depois da validação e autorização G3 iniciar o serviço externo e os testes funcionais reais.

Controles usam as funções financeiras homologadas, sem alteração: totais/categorias/conciliação/reembolsos e cobertura por ano, somas monetárias inteiras e contagens. Percentuais calculados são representados como strings quando fracionários para separar apresentação de números comerciais inteiros. Hash canônico preserva null, zero, arrays, opcionais e valores; ordem de chaves JSON não muda o conteúdo. Precisão fora do intervalo seguro bloqueia transporte, sem truncamento.

## 4. Testes sintéticos e reprodução

Pré-requisitos: Node 24, dependências do lockfile, Chromium para interface e PostgreSQL local de teste. O teste G2 usa **dois bancos locais separados**: o indicado por TEST_DATABASE_URL e `brazi_stage_test`, no mesmo servidor e com o mesmo usuário. Criar esse segundo banco apenas no cluster local sintético; o usuário de teste deve poder criar schemas e o papel temporário do ensaio RLS. Nunca usar conexão de produção, mesmo como administrador de teste.

TEST_DATABASE_URL precisa apontar a loopback e banco terminado em `_test`; o helper existente recusa destinos remotos. O segundo banco é derivado desse endpoint local. As ferramentas não criam serviços externos. No ensaio desta entrega foram usados PostgreSQL 17 na porta local 55432 e dados fictícios dos fixtures E1.

Após configurar TEST_DATABASE_URL local pelo ambiente:

```sh
npm test
npm run build
npm run test:e2e
npm audit
```

Teste G2 isolado: `npx tsx --test test/staging.test.ts`. Não publicar relatório com dados reais. Os testes criam/removem somente schemas/papel sintéticos e arquivos temporários; exigem ambiente local descartável. Nenhum comando de ensaio usa o token INK configurado no Codex: cenários de API usam mocks, inclusive com token fictício e contagem de zero fetch em staging.

Resultados desta entrega:

| Verificação | Resultado |
| --- | --- |
| Backend unitário/integração/segurança/regressão | **77 testes passaram; zero falhas, zero skips** (inclui 8 testes G2) |
| Build TypeScript + frontend | **Aprovado** |
| Interface Playwright, autenticação/MVP/E1/mobile | **8 testes passaram** |
| Auditoria npm, incluindo desenvolvimento | **0 vulnerabilidades reportadas** |

Os testes G2 comprovam:

- token presente sem fetch/aquisição de execução; endpoint, cliente, transporte e CLI sync bloqueados;
- destino de origem, outro usuário, mesmo banco/projeto e marcador errado recusados; startup não cria schema após preflight falho;
- ciclo real de CLI key/preflight/migrate/export/import em dois bancos locais, sem dotenv/fallback ou logs de segredos;
- pacote criptografado privado, chave errada/adulteração recusadas e recusa de sobrescrita/reimportação;
- preservação de runs/seen/missing, nulls/zeros/valores inválidos preexistentes e reembolsos órfãos, integridade de conteúdo e igualdade de resultados completos MVP/E1 entre origem e destino sintéticos;
- conteúdo pessoal extra, número inseguro, contagem incoerente e referência inválida recusados;
- leitor sintético com SELECT mas sem política RLS não produz snapshot falsamente vazio;
- corrupção sintética via trigger causa falha depois da carga/RESTART e rollback de todas as tabelas/identidade;
- alteração concorrente no catálogo sintético durante exportação não mistura versões, comprovando snapshot transacional único.

A regressão existente inclui o golden financeiro do MVP. Nenhum arquivo de regra financeira, autenticação, frontend ou migração de schema comercial foi alterado. O hook adicional de pré-migração só verifica identidade no staging; não introduz versão de banco nova.

## 5. Limitações e decisões antes de G3

- Nenhuma conexão real, vaga/cota, política RLS de produção ou credencial foi validada por esta entrega. A autorização de uso/exportação real e o método de acesso ainda precisam estar definidos.
- Não há provisionador nem bootstrap automático. O marcador deve ser preparado exclusivamente no projeto novo após aprovação. O preflight protege contra erro de destino e configuração, não contra administrador que substitua política/marcador deliberadamente.
- Pacote é processado em memória; limite operacional de arquivo: 128 MiB antes da criptografia. Executar export/import em ambiente seguro de operação, não no runtime Render Free. Medir volume e memória antes da janela real. Não particionar em snapshots independentes para contornar limite.
- Timeout de 30s por consulta, não SLA total. Sem retry automático de snapshot/carga: uma falha exige revisão e novo corte quando aplicável. Leitura prolongada ainda pode consumir recursos da origem.
- Contagens independentes ajudam a identificar filtragem RLS, mas não substituem autorização e validação de abrangência do papel. Nenhum papel/política é criado na origem pela ferramenta.
- A credencial de startup staging ainda precisa de DDL/propriedade no destino. Privilégios não se estendem à origem porque as credenciais/projetos são separados. Separação estrita migrador/runtime exige outra entrega autorizada.
- STAGING_CODE_REVISION deve ser confrontado pelo operador com `git rev-parse HEAD` e o SHA aprovado; não é inferido pelo banco nem substitui revisão de checkout limpo. Moeda e configurações de execução são registradas no manifesto operacional privado complementar.
- O hash não é assinatura de procedência; tratar SHA, política e chave como evidências sob controle do operador e manter separação de canais. A auditoria npm é evidência pontual, não garantia permanente de ausência de risco.
- Homologação real de rankings, evolução, pares, cobertura, filtros e responsividade continua pendente. Não fazer merge em main/release, deploy ou E2 por consequência desta publicação.

Antes de G3: aprovar SHA desta entrega, revisão das proteções, origem/leitor ou exceção, referência de contagens/corte, capacidade do destino, bootstrap privado do marcador, janela/retenção e responsáveis. Aplicam-se checklist pré-deploy e encerramento do runbook G1.
