# Deploy no Render — preparação, sem deploy executado

O projeto contém um Blueprint `render.yaml`. Nenhum recurso foi criado, nenhum comando de deploy foi executado e nenhuma credencial foi incluída no repositório.

## Plano necessário

**Sim: o serviço precisa ser pago para utilizar disco persistente no Render.** O plano Free de Web Service não permite anexar disco persistente. O Blueprint seleciona **Starter**, uma instância, e um disco inicial de **1 GB**; a cobrança do disco é adicional à do serviço. Confira valores atuais no Render antes de aplicar a configuração.

Referências: [Persistent Disks](https://render.com/docs/disks), [Pricing](https://render.com/pricing), [Blueprint specification](https://render.com/docs/blueprint-spec), [Web Services](https://render.com/docs/web-services), [Environment variables](https://render.com/docs/configure-environment-variables).

O acesso direto à documentação do Render retornou 403 na rede deste ambiente. Não foi possível validar o Blueprint no serviço do Render nem consultar preços ao vivo; os testes locais verificam sua coerência com a aplicação. A revisão/validação no Render deve preceder a criação do serviço pago.

## Preparação do repositório

Quando decidir fazer o deploy, envie o código para o repositório privado autorizado. Não envie `.env`, `.local`, banco SQLite, WAL/SHM, backups, tokens, senha ou hash de senha. O banco local atual não será transferido automaticamente pelo Git.

O `render.yaml` pressupõe que o projeto está na **raiz do repositório Git**, como neste checkout. Se colocá-lo em uma subpasta de um monorepo, configure Root Directory e a localização do Blueprint de forma consistente; não use `/workspace/brazi-dashboard` como diretório no Render.

Não aplique o Blueprint apenas para “ver a configuração”: aplicá-lo pode criar recursos cobrados e iniciar o primeiro deploy. `autoDeploy: false` evita deploys automáticos posteriores por novos commits, mas não transforma a criação do Blueprint em uma simulação.

## Configuração do serviço

| Campo | Valor |
| --- | --- |
| Tipo | Web Service, runtime Node |
| Plano | Starter ou outro plano pago compatível com disco |
| Instâncias | 1 |
| Node | 24.x, definido por NODE_VERSION e .node-version |
| Build | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start | `npm start` |
| Health check | `/health` |
| Disco | `brazi-data`, mount path `/var/data`, inicialmente 1 GB |
| SQLite | `/var/data/brazi/brazi.sqlite` |

Não fixe `PORT`: o Render fornece a variável. Em produção o Fastify escuta em `0.0.0.0` nessa porta. O React compilado é servido pelo próprio Fastify; não há servidor Vite em produção e não é necessário criar Static Site separado.

O build instala dependências de desenvolvimento explicitamente para compilar TypeScript/Vite e as remove depois. O runtime não depende de tsx ou Vite. Não há instalação de SQLite externo: usamos o incluído no Node 24.

O disco só é usado em runtime. O build não abre nem inicializa o banco. Não rode limpeza, sincronização ou migração dependente do disco em um pre-deploy command: a montagem do disco não está disponível nessa fase.

## Variáveis e segredos

Cadastre diretamente no painel de Environment do Render, nunca em arquivos versionados:

| Variável | Configuração |
| --- | --- |
| `NODE_ENV` | `production` (Blueprint) |
| `DATABASE_PATH` | `/var/data/brazi/brazi.sqlite` (Blueprint) |
| `AUTH_ENABLED` | `true` (Blueprint; não pode ser desabilitada em produção) |
| `AUTH_USERNAME` | Nome administrativo escolhido, exigido no painel |
| `AUTH_PASSWORD_HASH` | Hash gerado pelo comando abaixo, exigido no painel |
| `RESERVA_INK_TOKEN` | Token INK com store.orders.read, store.products.read e store.refunds.read |
| `BUSINESS_TIMEZONE` | `America/Sao_Paulo` (Blueprint) |
| `APP_ORIGIN` | Opcional no domínio padrão; para domínio próprio, origem HTTPS exata |
| `DISPLAY_CURRENCY` | Opcional; configure BRL somente após confirmar moeda/unidade da API |

`sync: false` no Blueprint significa que o valor será informado fora do YAML; não é uma credencial fictícia nem um valor já configurado. O token precisa estar no processo do backend no Render. Um GitHub Actions Secret ou segredo existente neste ambiente de desenvolvimento não é copiado automaticamente para o Render.

`RENDER_EXTERNAL_URL`, fornecida pelo Render, é usada como origem padrão. Exemplo de formato: `https://nome-do-servico.onrender.com`. Não inclui caminho, query ou fragmento. Se usar domínio próprio, configure-o no Render, espere a emissão do certificado e depois defina `APP_ORIGIN` para `https://seu-dominio`. Use essa mesma origem ao entrar; requisições de alteração vindas de outra origem serão rejeitadas.

### Gerar o hash de senha

Em um terminal confiável com o projeto e Node 24 — pode ser um terminal de desenvolvimento na nuvem, sem instalar nada no seu computador:

```sh
npm ci
npm run build
npm run auth:password
```

O comando solicita e confirma a senha com entrada oculta, sem aceitá-la em argumentos, ambiente ou arquivos. Use de 12 a 256 caracteres e prefira uma senha longa, única, gerada por gerenciador de senhas. Copie **somente o hash produzido** para `AUTH_PASSWORD_HASH` no painel do Render. Preserve todos os caracteres `$`. Não cole a senha nem o hash no chat, no GitHub ou em comandos que ficarão no histórico do shell.

O hash usa scrypt com salt aleatório, N=65536, r=8, p=2, chave de 64 bytes. Há limite de duas derivações simultâneas para conter uso de memória. Senhas em texto puro não são guardadas no banco ou no navegador. O hash também é uma credencial sensível e não deve ser versionado.

## Login e sessões

A primeira página pública apresenta somente o formulário de login e os arquivos estáticos. Indicadores, status da carga e sincronização exigem sessão autenticada. `/health` é público e devolve apenas `{status:"ok"}` para o health check do Render. `/api/auth/session` é público e retorna somente o estado de autenticação; não retorna dados comerciais para visitantes.

Uma única conta administrativa pode consultar e sincronizar. Esta versão não implementa cadastro público, papéis, MFA, recuperação de senha por e-mail ou SSO. A recuperação é administrativa: gere outro hash e altere a variável no Render, aplicando a nova versão do serviço.

As sessões são opacas, aleatórias, com duração absoluta de oito horas. O SQLite guarda apenas o SHA-256 do token, nunca o cookie em texto puro. Em produção o cookie tem prefixo `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` e nenhum Domain. Não há token em localStorage. Logout revoga a sessão no servidor; expiração ou alteração de usuário/hash também revoga o acesso. Sessões válidas sobrevivem a reinícios/deploys se o disco, a origem e as credenciais forem mantidos.

Há limite persistente de dez tentativas de login por IP e 60 globais por janela de 15 minutos, incluindo tentativas bem-sucedidas. A resposta 429 informa Retry-After. O servidor guarda somente uma chave derivada do IP para esse controle; logs HTTP estão desabilitados e não registram credenciais. Em caso de bloqueio legítimo, aguarde a janela; não desabilite a autenticação.

Login, logout e sincronização exigem JSON, cabeçalho de segurança e origem autorizada. Se a sessão expirar durante o uso, os dados da interface são removidos e o formulário de login reaparece.

## HTTPS

O Render fornece terminação TLS e certificado para o domínio padrão, e certificados gerenciados para domínios próprios configurados corretamente. O Node recebe HTTP atrás desse proxy; não se deve instalar certificado privado na aplicação.

Em produção o Fastify reconhece o proxy imediato, exige protocolo HTTPS informado pelo proxy e emite HSTS. GET/HEAD em HTTP são redirecionados para a origem HTTPS configurada. Requisições de alteração em HTTP são recusadas, sem emitir sessão. `/health` é a exceção mínima para sondagens internas e não revela dados.

Não coloque outro proxy não confiável antes do Node nem exponha a porta diretamente fora da arquitetura do Render. O reconhecimento de proxy e dos cabeçalhos HTTPS pressupõe o ingresso do Render. Testes locais simulam esses cabeçalhos; não substituem a verificação do certificado no domínio real após um deploy autorizado.

## Primeira carga e persistência

O primeiro serviço Render terá banco vazio. Após autenticar, clique em Atualizar dados para buscar o histórico da INK. Não embuta o banco de desenvolvimento na imagem/repositório. Para transferir um banco existente em vez de sincronizar novamente, use backup SQLite consistente e transferência privada, com o serviço parado; não copie apenas o arquivo principal enquanto existir WAL ativo.

Banco, WAL, SHM, sessões e controle de tentativas ficam dentro do mesmo disco `/var/data`. Reinícios e deploys reutilizam esse caminho. O aplicativo recusa iniciar em produção com caminho relativo e, ao detectar RENDER=true, exige `/var/data` existente e arquivo dentro dele; não faz fallback silencioso para armazenamento efêmero.

Não exclua/recrie o disco ou altere DATABASE_PATH sem um plano de migração. A região do serviço e do disco deve ser a mesma. Uma instância com disco persistente não oferece o mesmo mecanismo de deploy sem interrupção de um serviço sem disco; planeje uma breve indisponibilidade. Uma carga interrompida mantém a última versão concluída e poderá ser refeita.

SQLite exige uma única instância nesta arquitetura. Não ative autoscaling nem um segundo Web Service escrevendo no mesmo arquivo. Para escalar horizontalmente, será necessária outra arquitetura de armazenamento/coordenação.

Faça backups consistentes e teste a restauração. Persistência entre deploys não protege contra exclusão do disco ou erro operacional. Guarde backups e qualquer cópia do banco como dados comerciais privados; os backups também contêm metadados de autenticação. Consulte as opções atuais de snapshots/backup do disco no Render, sem presumir que qualquer cópia de arquivo isolado com WAL ativo é consistente.

## Verificação após um deploy futuro autorizado

1. Acesse a URL HTTPS e confira certificado válido e formulário de login, sem indicadores públicos.
2. Confira que `/health` responde sem detalhes de dados e que `/api/status` sem login retorna 401.
3. Faça login e confira o cookie Secure/HttpOnly/SameSite=Strict no navegador.
4. Sincronize, confira última carga e indicadores, depois faça logout e confirme que os endpoints voltam a exigir login.
5. Após um deploy/restart autorizado, confirme a mesma cobertura no banco e a preservação da última carga.

Para sincronizar pelo Shell do Render, use `npm run sync:prod`, que executa o JavaScript compilado. `npm run sync` usa tsx e é destinado ao desenvolvimento, pois as dependências de desenvolvimento são removidas em produção.

Nenhuma dessas etapas foi executada no Render durante a preparação. Os testes locais cobrem portas, cookies, sessões, bloqueio de HTTP/CSRF, persistência e o build sem dependências de desenvolvimento.
