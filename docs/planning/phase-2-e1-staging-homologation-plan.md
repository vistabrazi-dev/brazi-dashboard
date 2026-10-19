# E1 — Plano de homologação em staging isolado

Data: 19/10/2026. Status: **proposta para aprovação; nenhuma infraestrutura provisionada**.
Branch de trabalho: `develop/phase-2`. Escopo: homologação funcional da E1 com dados comerciais autorizados, sem E2 e sem modificar regras financeiras.

## 1. Recomendação executiva

Usar um serviço Render separado e um projeto Supabase separado dos de produção. Render Free + Supabase Free é uma possibilidade, condicionada à disponibilidade de projetos, cotas de horas, armazenamento, conexões e tráfego. Não habilitar upgrade automático ou cobrança sem aprovação.

Priorizar a avaliação de uma fonte comercial somente leitura, com credencial independente. **A E1 atual não funciona simplesmente trocando DATABASE_URL por uma credencial somente leitura:** a inicialização executa migrações e o login escreve sessões e tentativas no mesmo banco. O acesso sem cópia exige uma pequena entrega técnica de isolamento de persistência, autorizada separadamente, antes do provisionamento. Não é uma mudança de regras comerciais nem início de E2.

Para a primeira homologação, recomendar um **snapshot consistente e mínimo das tabelas comerciais normalizadas em projeto Supabase exclusivo**, obtido por leitura autorizada da origem. Isso permite testar o código E1 atual sem conectar o processo de staging ao banco de produção e sem executar migrações nele. A cópia contém informações comerciais confidenciais e precisa de aprovação específica, mesmo sem dados de clientes. Se a cópia não for autorizada, seguir a opção de leitura remota somente após resolver os pré-requisitos técnicos e de acesso descritos abaixo.

O MVP 1.0 permanece no serviço, banco, schema, domínio, credenciais e branch atuais. Não reutilizar serviços existentes, grupos de segredos ou o Blueprint de produção para criar staging. Não executar sincronização INK neste processo.

## 2. Evidências da revisão do código

| Componente | Comportamento atual | Consequência |
| --- | --- | --- |
| `src/server.ts` e `src/storage/store.ts` | Uma conexão/configuração de banco; `Store.open()` chama `migrate()` | O processo não pode iniciar contra a origem comercial somente leitura |
| `src/storage/migrate.ts` | Transação, advisory lock, criação de schema/tabela e configuração de permissões | Mesmo em banco atualizado, não tratar o startup como SELECT somente leitura |
| `src/storage/store.ts` | Login/logout/limitação de tentativas escrevem `auth_sessions` e `auth_attempts` | Autenticação precisa de persistência gravável exclusiva de staging |
| `src/storage/migrations/001-initial.ts` | RLS nas tabelas; não há políticas SELECT para um novo papel leitor | Apenas conceder SELECT pode resultar em nenhum dado visível; verificar políticas antes de prometer leitura remota |
| Integração/sincronização | Token ausente impede início da sincronização | Não cadastrar `RESERVA_INK_TOKEN` no staging; para fonte remota, exigir também bloqueio explícito de sincronização no servidor |
| E1 | Calcula usando snapshot PostgreSQL existente, sem novas chamadas INK por visualização | Não é necessário token INK para homologar inteligência de produtos |
| `render.yaml` | Serviço `brazi-dashboard`, plano `free`, sem disco, auto deploy desligado | Não aplicar esse nome sobre o serviço de produção; preparar configuração distinta somente após autorização |

A simples alteração de `DATABASE_SCHEMA` não constitui isolamento de projeto e não remove a execução de migrações. Não usar `PGOPTIONS`, desativação de TLS, papel proprietário da produção, `BYPASSRLS` ou chave `service_role` como atalhos para obter leitura.

## 3. Alternativas e decisão

| Opção | Isolamento e exposição | Trabalho prévio | Parecer |
| --- | --- | --- | --- |
| A. Snapshot mínimo em Supabase separado | Sem conexão da aplicação de staging à produção; cópia privada de dados normalizados | Exportação consistente, allowlist de campos, importação/validação e autorização de cópia | **Recomendada para primeira homologação**, se aprovada a cópia |
| B. Leitura remota + autenticação em Supabase separado | Dados comerciais permanecem na origem; consultas ainda consomem recursos de produção | Separar pools/repositórios de leitura e autenticação, impedir migração/escrita na origem e validar acesso RLS | Prioritária quando zero cópia for requisito; **não disponível por configuração na versão atual** |
| C. Novo schema no projeto de produção | Compartilha recursos, pool, limites e risco de erro de configuração | Permissões rigorosas e ajustes de inicialização | Não recomendar para esta homologação |
| D. Clone integral/branch de banco | Pode copiar dados pessoais, sessões e segredos; disponibilidade/custo dependem do plano | Sanitização e avaliação de produto/plano | Não utilizar como padrão Free |

### 3.1. Opção A — execução proposta

1. Confirmar autorização de uso/cópia, capacidade gratuita e janela de homologação antes de criar recursos.
2. Registrar commits: E1 revisada `a5fd144e1e6fdfafb3f0ca8c4d6f088d6450e131`; referência MVP `be218e443ab6a651a88ddb8d337159c11ecbe6d9`. Confirmar novamente os SHAs antes da execução; qualquer correção recebe revisão e novo SHA.
3. Preparar banco exclusivo de staging. Migrações só podem atingir esse projeto, com identificação positiva do destino e credencial exclusiva. Não aceitar apenas uma variável de nome de schema como proteção.
4. Exportar dados mínimos em transação consistente `REPEATABLE READ READ ONLY`, com tempo limite e janela de baixo impacto. Preferir papel independente com USAGE e SELECT apenas nas tabelas autorizadas. A existência desse papel/políticas **não foi verificada**. Se for necessário criá-los ou alterar políticas na produção, interromper e pedir autorização específica; não criar durante testes.
5. Se não houver leitor independente viável sem mudanças na origem, avaliar exportação pelo operador autorizado em transação somente leitura. Registrar a exceção de privilégio; não instalar credencial de proprietário de produção no staging. Sem aprovação dessa exceção, usar apenas dados sintéticos e manter homologação real pendente.
6. Transferir artefato por canal privado, com acesso restrito e criptografia; nunca por Git, chat, logs ou pasta pública. Importar somente no projeto de staging e conferir manifesto antes de liberar a aplicação.
7. Na versão atual, a credencial de startup precisa dos privilégios de migração **somente no projeto isolado**. Isso é uma limitação de mínimo privilégio do runtime. Se a exigência for privilégio mínimo também no destino, aprovar previamente a separação migrador/runtime, com DDL apenas no migrador, SELECT comercial no runtime e escrita limitada às tabelas de autenticação. Não afirmar que essa separação já existe.
8. Após carga, não atualizar automaticamente o snapshot. Registrar data de corte, versão da sincronização e limitações de atualidade. A carga não deve chamar a API INK.

### 3.2. Opção B — condições obrigatórias para leitura remota

- Pool comercial com papel dedicado, sem propriedade, superuser, criação de banco/papéis, replicação ou bypass de RLS. SELECT somente em `orders`, `products`, `refunds` e nos metadados indispensáveis de `runs`/`meta`; sem acesso às tabelas de autenticação. Restringir também privilégios herdados e acesso a outros schemas.
- Verificar políticas RLS aplicáveis: hoje as migrações não criam políticas para leitor externo. Novas políticas/permissões na origem são mudanças de segurança de produção e dependem de autorização distinta; não fazem parte de testes ou migrações de staging. Se proibidas ou indisponíveis, esta opção não é viável.
- Pool gravável separado para sessões/tentativas de staging. Migrações devem atuar exclusivamente nesse destino; nenhuma chamada a `migrate()` pode receber a conexão da origem.
- Credenciais distintas para fonte, estado de staging e migração. Nomes adicionais de variáveis e modo de leitura são **proposta futura**, não configurações suportadas hoje.
- Impedir sincronização e toda escrita comercial no servidor, mesmo se um token for cadastrado por engano. Privilégios PostgreSQL são a barreira principal; transações read only são defesa adicional.
- TLS com validação de certificado; Session Pooler e usuário de papel dedicado compatíveis com o projeto, confirmados no Supabase. Não presumir que o login `postgres` direto ou a identidade do SQL Editor valida o pooler.
- Limitar inicialmente a uma conexão de leitura e uma de estado, com timeouts. Não executar carga/estresse sobre produção. Medir apenas consultas aprovadas; cache não torna esse acesso isento de custo.
- Validar proibição de DDL/DML por inspeção de privilégios e testes negativos em réplica sintética com configuração equivalente. Não tentar INSERT/UPDATE/DDL contra a produção para provar que falham.

## 4. Dados permitidos e minimização

O armazenamento normalizado atual não inclui nome, documento, e-mail ou endereço do comprador. Isso reduz a exposição, mas não torna pedidos/identificadores/dados comerciais públicos ou automaticamente anônimos.

| Fonte normalizada | Conteúdo necessário | Cuidados |
| --- | --- | --- |
| `orders` | Identificador técnico, dia, status de pedido/pagamento, classificação de troca, valores normalizados, itens e issues necessários às regras | Preservar valores inteiros e campos opcionais; não buscar payload bruto ou cliente |
| Itens em `orders.data` | SKU/IDs de produto e variante disponíveis, quantidade, grátis, reembolsada, unitário e total | Preservar conflitos/ausências e itens não associados; não excluir para melhorar cobertura |
| `products` | IDs, nomes de catálogo, IDs de variantes e SKUs já utilizados pela associação | Nomes também podem ser comercialmente confidenciais; não enriquecer estampa/cor/modelagem |
| `refunds` | Identificador do pedido e eventos/status/valores/flags/issues normalizados usados na classificação | Preservar vínculo e histórico necessário; não copiar comprovantes ou dados pessoais |
| `runs` / `meta` | Apenas identificação de versão, corte, sucesso, contagens/datas e timezone necessários à consistência/status | Omitir textos livres de erros e histórico desnecessário; documentar mapeamento de IDs de execução se houver |

Não copiar `auth_sessions`, `auth_attempts`, credenciais, hashes de login, arquivos `.env`, dumps integrais, logs brutos ou payloads INK. Criar `schema_migrations` a partir das migrações do código de staging, sem transplantar histórico de outro banco. Não pseudonimizar IDs independentemente: qualquer transformação aprovada precisa preservar relações de pedidos, reembolsos, catálogo e execuções.

Manifesto privado: SHA do código, instante de corte, timezone/moeda configurados, versão de origem/destino, contagens, intervalo de datas e totais de controle por classificação; registrar campos excluídos. Tamanho/contagens do banco real não foram medidos nesta etapa. Verificar consistência do conjunto completo autorizado, não somente uma amostra. Uma amostra isolada não homologa rankings globais, pares ou cobertura global.

Retenção proposta: até 7 dias após a decisão de homologação, máximo inicial de 30 dias desde a carga; extensão requer aprovação. Remover exportações temporárias após conferência da importação. Evidências com números reais permanecem privadas; somente fixtures sintéticas podem ir ao repositório.

## 5. Custos e viabilidade Free — validação antes de provisionar

Estimativa de infraestrutura incremental: **US$ 0**, apenas se todos os recursos couberem nas franquias gratuitas e houver vagas disponíveis. Não é uma garantia de preço/capacidade. As referências abaixo precisam ser confirmadas nos painéis e documentação vigente no momento da aprovação; não houve consulta aos painéis das contas nem validação online dos preços nesta etapa.

| Recurso | Referência de planejamento | Limitação/decisão |
| --- | --- | --- |
| Render Free web service | US$ 0; referência de 750 horas gratuitas por workspace/mês | Horas compartilhadas podem afetar produção. Dois serviços ativos continuamente excederiam a franquia; confirmar saldo e reservar a produção antes de autorizar staging |
| Render Free execução | Suspensão após cerca de 15 min sem tráfego; cold start; sem disco persistente; recursos limitados | Homologar retomada e distinguir latência fria de erro funcional; não usar keep-alive artificial |
| Supabase Free projeto separado | US$ 0 se houver vaga; referência de limite de dois projetos Free ativos, sujeito às regras da conta | Verificar capacidade real da conta/organização; nunca pausar ou substituir produção para abrir vaga |
| Supabase Free dados/tráfego | Referências de 500 MB de banco/projeto e franquia de egress da ordem de 5 GB/mês | Confirmar franquias vigentes e consumo incluindo índices, importação/exportação e consultas; sem tamanho real não garantir que o conjunto cabe |
| Supabase Free disponibilidade | Possível pausa após aproximadamente 7 dias de inatividade; limites de conexão; sem garantias de backup/PITR/SLA de planos superiores | Snapshot reproduzível, retomada documentada e backup privado aprovado; não depender de staging como arquivo definitivo |
| TLS/domínio | Usar HTTPS do domínio padrão Render e pooler com TLS | Domínio próprio não é necessário; não contratar nada nesta fase |
| Trabalho e alternativas pagas | Preparação/revisão/homologação não estão incluídas no custo de infraestrutura | Se Free não couber, apresentar cotação oficial e período antes de contratar; nenhuma migração automática para pago |

Exemplo de risco de horas: um serviço ligado 24h/dia utiliza 720h em mês de 30 dias ou 744h em mês de 31 dias. Com franquia de 750h restariam respectivamente 30h ou 6h, antes de outros consumos. Tráfego e suspensão tornam o consumo real variável. Exigir saldo observado e orçamento de janela; interromper staging antes de consumir a reserva. Não assumir que criar outro serviço ou projeto isola cotas de workspace/conta. Se houver workspace legítimo separado disponível, avaliar o isolamento de quota conforme as regras do provedor, sem contornar limites.

Portão de viabilidade: responsável confirma vagas, saldo, armazenamento estimado e conexões disponíveis; define limite de horas e data de encerramento. Se qualquer item ameaçar produção, **não provisionar no Free compartilhado**. Rever a janela, o isolamento ou uma alternativa paga explicitamente aprovada.

Referências para confirmação: [Render Free](https://render.com/docs/free), [Render pricing](https://render.com/pricing), [Supabase pricing](https://supabase.com/pricing), [conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 6. Configuração de staging a preparar após aprovação

- Serviço com nome exclusivo, por exemplo `brazi-dashboard-e1-staging`, conectado a `develop/phase-2` e ao SHA aprovado. Deploy automático desligado. Não editar `main`, `release/mvp-1.0`, domínio ou serviço de produção.
- Frontend e Fastify no mesmo serviço/origem HTTPS, mantendo autenticação atual. `PORT` fornecida pelo Render, build/start conforme repositório. Sem disco e sem SQLite.
- `NODE_ENV=production`, origem HTTPS exclusiva e login obrigatório. Usuário/hash e sessões exclusivos; senha gerada fora do chat/logs. Cookies Secure/HttpOnly e isolamento por host conforme autenticação existente; não compartilhar cookies entre staging e produção.
- Na opção A, `DATABASE_URL` aponta exclusivamente ao Session Pooler do novo projeto, com TLS verificado, schema exclusivo e pool pequeno (inicialmente 1–2 conexões). Não reutilizar URL de produção nem grupos de ambiente compartilhados. Segredos só no gerenciador do serviço.
- Timezone, moeda e opções financeiras iguais às homologadas, sem alterar regras ou presumir moeda pelo nome da empresa. Não cadastrar `RESERVA_INK_TOKEN`. Nenhum job de sincronização/agendamento INK.
- Validar destino por referência de projeto/host e metadados não secretos antes do startup; evitar registro de URLs, usuário, senha ou hash. Um check de nome do banco como `postgres` não identifica o projeto.
- Autenticação é obrigatória antes de qualquer exposição externa; todas as rotas comerciais devem exigir sessão. Conferir que healthcheck/erros públicos não revelam dados, configuração ou rastros sensíveis. Não incluir scripts externos de analytics.
- Ensaiar migração e reinício primeiro em banco sintético isolado. Migrações idempotentes/reentrada segura não autorizam executá-las na origem real.

## 7. Referência de cálculo e amostras de auditoria

Congelar dataset, commits, timezone, moeda e período antes de comparar. Reexecutar o baseline MVP e a E1 contra **o mesmo snapshot isolado**, com um verificador independente das respostas E1; não usar resultados do próprio ranking como única referência. Não é necessário subir outro serviço público para obter o baseline. Não comparar números de produção em atualização com snapshot antigo como se a divergência fosse defeito.

Selecionar casos existentes no snapshot para: venda paga elegível; grátis; desconto e frete; troca; reembolso integral/parcial; conciliação; cancelado/expirado/não pago; status desconhecido; SKU ambíguo; produto não associado; A+A+B; A+B+C; bordas de mês/dia; produto fora dos 100 candidatos globais. Ausência de uma categoria real deve ser registrada, com teste sintético complementar separado — nunca fabricar um registro como se viesse da origem.

Regras de aceite preservadas:

- Elegibilidade e classificação permanecem as do MVP, inclusive exclusões e pendências. Não apresentar faturamento líquido definitivo com pendências de conciliação.
- Valor atribuído a produtos respeita o rateio homologado de descontos sobre os itens e não inclui o frete líquido do pedido. Portanto, soma do ranking **não precisa ser igual** ao faturamento confirmado que inclui frete: reconciliar pela ponte de itens/descontos/frete prevista no código.
- Quantidades respeitam a regra existente de itens grátis e reembolsos; não subtrair `refunded_quantity` novamente por conta própria.
- Pedidos por produto são distintos dentro do produto e não aditivos entre produtos. Produtos presentes apenas em itens grátis podem ter contagem de pedidos e zero unidades líquidas conforme regra atual; cestas usam produtos com quantidade elegível positiva.
- Não associados entram nos totais/cobertura conforme implementação, sem criar identidade artificial para formar pares.

## 8. Checklist funcional e critérios de aceite

Cada linha deve receber resultado, evidência privada, responsável e data. Só marcar concluída após execução. Comparações monetárias usam inteiros na unidade interna: diferença aceitável **zero**; formatação visual segue arredondamento existente. Percentuais aceitam apenas diferença do arredondamento exibido.

| Área | Validação | Critério de aceite |
| --- | --- | --- |
| MVP preservado | Comparar indicadores financeiros, categorias e totais baseline/E1 no mesmo snapshot | Igualdade exata; nenhuma mudança de regra ou exclusão silenciosa |
| Ranking | Ordenar por unidades, pedidos, valor e nome; asc/desc; empates, busca e paginação | Referência independente coincide; sem linhas perdidas/repetidas; ordenação e seleção estáveis |
| Associação | Conferir IDs de produto/variante, SKU único, conflito e ausência | Mesmos vínculos do algoritmo aprovado; conflitos permanecem não associados |
| Valores | Reconciliar itens, rateio de descontos e ponte para frete/faturamento | Centavos exatos, incluindo grupo não associado; sem dupla subtração de reembolsos |
| Unidades/pedidos | Conferir repetição de linhas, grátis e pedidos com vários produtos | Quantidades corretas; cada pedido conta uma vez por produto; não somar pedidos de produtos como total da loja |
| Evolução | Produto selecionado por dia e mês, com bordas de período e meses sem venda | Totais coerentes com ranking/mesmo produto/período; comportamento de dias vazios conforme contrato; sem deslocamento de timezone |
| Cestas | A+A+B, A+B+C, mesmo produto em variantes, itens grátis e desconhecidos | Produtos distintos deduplicados por pedido; AB ocorre uma vez, ABC gera AB/AC/BC, nunca AA |
| Participação | Recalcular contagem do par / total de pedidos confirmados do período × 100 | Denominador conforme contrato, não somente pedidos com cesta; percentuais de pares não precisam somar 100% |
| Limite global | Catálogo acima de 100 candidatos e produto fora do corte | Corte global sinalizado, cobertura não presumida em 100%; investigar produto busca todos os parceiros conforme escopo implementado |
| Cobertura | Conferir itens/unidades/valores não associados e cobertura de ocorrências de pares | Contagens e denominadores reproduzíveis; cobertura de pares não confundida com cobertura de catálogo/receita |
| Filtros | Intervalos curtos/longos, mesmo dia, início/fim, mês/ano, sem resultado, datas inválidas | Mesma semântica inclusiva do contrato; inválidos rejeitados sem erro interno; troca de período não mantém resultado antigo |
| Investigação | Selecionar/limpar produto, busca, paginação de pares, produto ausente no período | Título/escopo/filtros correspondem aos dados; 404/estado vazio tratados sem travamento |
| Estado/cache | Repetir consultas, alternar períodos e sessões; versão de snapshot | Sem mistura entre versões/períodos; limites de cache e resposta 503/Retry-After tratados conforme contrato |
| Atualidade | Mostrar corte/última sincronização e limitação do snapshot | Não sugerir dados em tempo real; atualização manual não inicia importação INK |
| Interface | Desktop 1440px, tablet 768px, celular 360/390px; teclado e zoom 200% | Sem controles inacessíveis/sobreposição; tabelas com rolagem utilizável, rótulos legíveis, foco e filtros funcionais |
| Estados | Loading, vazio, erro de rede, sessão expirada, cold start/retomada | Mensagem clara e recuperação; nenhuma exibição de dados de sessão anterior após logout |

## 9. Segurança, performance e operação

- [ ] Confirmar nenhuma mudança de branch, serviço, schema, credencial ou job de produção; checklist de configuração revisado por segunda pessoa antes do primeiro startup.
- [ ] Confirmar nenhum segredo/dado real em repositório, build, HTML, logs, screenshots públicos ou bundles. Evidências de tela reais somente em canal privado autorizado, com nomes/identificadores desnecessários ocultos.
- [ ] Sem sessão, rotas de ranking/evolução/cestas e demais endpoints comerciais devem recusar acesso; testar login, logout, expiração, origem indevida e cookie HTTPS somente no staging.
- [ ] Conferir permissões e isolamento de autenticação; testes destrutivos/negativos exclusivamente no banco sintético/staging, nunca na origem comercial.
- [ ] Rodar suítes existentes unitárias, integração, segurança e interface em ambiente de teste isolado, além de build/auditoria de dependências. Não apontar TEST_DATABASE_URL para origem ou snapshot de homologação. Evidenciar executados/falhos/omitidos separadamente.
- [ ] Medir primeira consulta após aquecimento, consultas em cache, investigação de produto, memória e conexões. Proposta inicial: p95 aquecido até 5s para carga limitada a dois revisores; medir cold start separadamente. Não prometer SLA Free a partir do benchmark local.
- [ ] Fazer qualquer teste de carga somente na opção A ou dataset sintético. Na opção B, limitar a uso manual/consultas previamente autorizadas e interromper se afetar produção.
- [ ] Medir memória com vários períodos e cache, não apenas um agregado; parar se houver OOM, conexões saturadas, aproximação das cotas ou impacto no MVP. Não aliviar custo removendo registros ou mudando regras financeiras.
- [ ] Verificar reinício do Render sem perda de snapshot/estado no Supabase, e procedimento de retomada após pausa. Nunca gerar tráfego artificial para impedir suspensão Free.
- [ ] Registrar resultado de migração/reinício do staging e fingerprint não secreto do destino. Nenhum teste/migração no schema de produção.

## 10. Sequência e aprovações

| Portão | Entrega e decisão | Ações ainda não autorizadas |
| --- | --- | --- |
| G0 — aprovação deste plano | Escolher A ou B; autorizar ou recusar cópia; confirmar revisores, retenção e orçamento máximo | Toda criação de recurso, alteração de credencial/política, deploy ou implementação |
| G1 — verificação de capacidade/acesso | Confirmar cotas/preços atuais, vagas, tamanho estimado e leitor disponível; apresentar exceções e custo final | Nenhum recurso se viabilidade depender de gasto ou mudança de produção ainda não aprovados |
| G2 — preparação autorizada | Se B ou mínimo privilégio estrito no runtime: revisar previamente a entrega técnica necessária e testes sintéticos; se A: revisar procedimento de snapshot | Alterações de segurança da origem sempre exigem autorização própria; não são implícitas na aprovação do plano |
| G3 — autorização operacional | Aprovar explicitamente recursos nomeados, configurações, SHA, fonte/dataset e janela | Só então provisionar, migrar destino, carregar snapshot autorizado e fazer deploy exclusivo de staging |
| G4 — homologação | Executar checklist e registrar evidências/resultados privados | Sem merge em main, deploy de produção ou E2 |
| G5 — decisão e encerramento | Aprovar/reprovar E1 funcionalmente; listar defeitos/bloqueios; encerrar staging conforme retenção aprovada | Produção/E2 dependem de nova autorização; remoção de recursos/revogação deve estar abrangida na autorização operacional |

Critérios de bloqueio: divergência financeira, escrita/migração na origem, acesso não autenticado, vazamento, snapshot inconsistente, falta de orçamento Free seguro, impacto em produção ou cobertura apresentada de forma enganosa. Uma limitação corretamente sinalizada pode ser aceita pelo responsável; não deve ser ocultada como resultado completo.

Relatório de saída: SHAs, corte do dataset, condições/limites do ambiente, matriz de testes com evidências, reconciliações agregadas privadas, desempenho medido, limitações e assinatura de aprovação funcional. Homologação com apenas dados sintéticos não encerra a pendência de dados reais.

## 11. O que foi feito nesta etapa

Revisão estática da inicialização, persistência/autenticação, permissões e configuração Render; elaboração deste plano em `develop/phase-2`. Não houve conexão a banco real, exportação, migração, teste funcional em dados reais, alteração de código/configuração/credenciais, criação de serviço, deploy, push ou início de E2. Os checklists acima são atividades futuras, não resultados já obtidos.

Leituras relacionadas: [avaliação técnica](phase-2-technical-assessment.md), [entrega E1 e evidências sintéticas](phase-2-e1-delivery.md).
