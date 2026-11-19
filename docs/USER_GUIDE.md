# Guia do usuário — Automation Studio

Aplicativo para Windows 11 que cria, executa e acompanha automações desenhadas como fluxos visuais. Tudo roda no seu computador; nenhum dado sai dele.

> **Estado atual:** versão de desenvolvimento (0.x), ainda sem instalador. Itens marcados com ⚠️ dependem do Windows e ainda não foram validados em uma máquina real.

## 1. Primeiros passos
1. **Dashboard** mostra o motor de automação (deve estar "Disponível"), as execuções recentes e os totais de sucesso/falha.
2. **Automações → Nova automação** cria um fluxo em branco; **Novo a partir de exemplo** traz fluxos prontos (organizar PDFs, organizar por tipo, backup condicional, Bloco de Notas…).
3. **Abrir** leva ao editor. Arraste nós da biblioteca (esquerda) para o canvas e ligue a saída de um à entrada do próximo.

## 2. O editor
- **Propriedades** (direita): configura o nó selecionado. O botão **Inserir…** oferece só variáveis e resultados que existem *naquele ponto* do fluxo.
- **Variáveis**: valores do fluxo, com tipo (texto, número, lógico). No mesmo painel: **tempo limite** do fluxo e **política de erro** (parar na primeira falha, ou continuar pelo caminho normal e terminar "com avisos").
- **Problemas**: erros impedem a execução; avisos não. Clique no problema para ir ao nó.
- **Salvar** (Ctrl+S) cria uma versão nova; versões salvas nunca são alteradas. Desfazer/Refazer: Ctrl+Z / Ctrl+Y. Duplicar: Ctrl+D.
- Fechar a tela com alterações não salvas pede confirmação.

### Expressões
Dentro de campos de texto use `{{variables.nome}}`, `{{nodes.<id>.<resultado>}}` ou `{{item.propriedade}}` (dentro de "Para cada item"). Nada é calculado além de ler esses valores.

## 3. Executar e depurar
| Botão | O que faz |
|---|---|
| **Executar** | Roda o fluxo **como está na tela** (mesmo sem salvar). |
| **Passo a passo** | Pausa antes de cada nó; use **Próximo passo** ou **Continuar**. |
| **Pausar / Continuar** | A pausa vale **ao fim do nó em andamento** (uma espera longa termina antes de pausar). |
| **Executar a partir daqui** | Começa no nó selecionado, sem rodar os anteriores; você pode dar valores iniciais às variáveis. Resultados de nós anteriores não existem nesse modo. |
| **Cancelar** | Interrompe, inclusive com a execução pausada. |

**Breakpoints:** clique no ● do nó (ou F9 com o nó selecionado) para pausar antes dele. Ficam só neste computador e não vão para o arquivo do fluxo.

O painel **Execução** mostra o nó atual, o estado de cada nó e, na pausa, as **variáveis e resultados** naquele ponto. Falhas apontam o nó e a causa.

## 4. Histórico
**Histórico** lista todas as execuções (filtros por automação, resultado e período), com log por nível, a causa da falha, o contexto final e a versão salva usada (ou "rascunho"). Sobrevive a fechar o app. Se o app fechar no meio de uma execução, ela aparece como interrompida. Limites: 2000 execuções e 5000 linhas de log cada; **Limpar histórico** apaga tudo (as automações ficam).

> Atenção: valores de variáveis aparecem no histórico. Não guarde senhas em variáveis.

## 5. Importar e exportar
- **Exportar** (lista de automações) grava a **versão salva** em um arquivo `.json`. Fluxo nunca salvo precisa ser salvo antes.
- **Importar…** mostra um **resumo** (nós, conexões, variáveis, problemas) antes de criar a automação. Importar **nunca executa** o fluxo; revise e rode você mesmo.
- Arquivos de versão desconhecida, inválidos ou de outros programas são recusados.

## 6. Agendamentos
**Agendamentos → Novo agendamento**: uma vez, todos os dias, dias da semana ou ao entrar no Windows. Você vê a próxima e a última execução (e como terminou), pode **desativar**, **editar** e **excluir**.
- Quem dispara é o **Agendador de Tarefas do Windows**; o app não precisa estar aberto.
- Roda a **versão salva** do fluxo, na **sua sessão** (sem administrador). Ações de mouse e teclado exigem sessão conectada e **desbloqueada**; com a tela bloqueada elas não funcionam.
- Computador desligado na hora: a execução acontece assim que ele ligar.
- Não roda se o agendamento estiver desativado, a automação arquivada/excluída, o fluxo nunca tiver sido salvo ou já houver outra execução; o motivo aparece em "Última".
- ⚠️ Registro real no Windows ainda **não validado**; com o app em modo de desenvolvimento o agendamento fica só salvo ("Não registrado").

## 7. Configurações
Tema (claro/escuro/sistema) e **captura de tela em falhas** (desligada por padrão). Ligada, a tela é salva quando um nó falha; a imagem pode mostrar dados sensíveis, fica só neste computador e é apagada com o histórico.

## 8. Automação web (Navegador)
Nós **Abrir página**, **Clicar no elemento**, **Preencher campo**, **Extrair da página**, **Esperar elemento** e **Fechar navegador**. O navegador abre em segundo plano na primeira vez, é compartilhado pelos nós do mesmo fluxo e fecha sozinho no fim (ou ao cancelar). Use **seletores** (`#id`, `.classe`, `text=Entrar`, `role=button[name='Entrar']`), não coordenadas. O texto digitado em "Preencher" não aparece nos logs. "Mostrar o navegador" ajuda a depurar. Exige o pacote `playwright` no motor e Edge/Chrome instalado; ⚠️ ainda não validado no Windows e **não incluído no motor empacotado** (veja `docs/engine-packaging.md`).

## 9. Subfluxos (Chamar fluxo)
O nó **Chamar fluxo** (Controle) executa **outra automação** e continua quando ela terminar. Escolha o fluxo no nó: as **variáveis dele viram os parâmetros** (deixe vazio para usar o valor padrão) e, ao terminar, as variáveis finais voltam em `{{nodes.<id>.outputs.<variável>}}` (o painel mostra a lista). Roda a **versão salva** do outro fluxo (salve-o antes). Pausa, passo a passo e breakpoints entram no fluxo chamado; os nós dele aparecem como "Fluxo › Nó".
Limites: até 5 fluxos encadeados; ciclos (A chama B que chama A) param com mensagem clara; renomear uma variável do fluxo chamado exige atualizar os chamadores; exportar um fluxo não leva os fluxos que ele chama.

## 10. Plugins
**Plugins → Instalar plugin…** adiciona um **nó novo** (categoria "Plugins" na paleta) que combina nós que o app já tem. Plugins **não trazem código**: o app mostra um resumo antes de instalar e nunca instala sozinho; dá para **desativar** ou **remover** a qualquer momento (as automações que usam o nó deixam de executar até reinstalar). Formato e como criar: `docs/PLUGINS.md`.

## 11. Clicar em elemento (UIA)
O nó **Clicar em elemento** (categoria "Janelas e aplicativos") clica em um botão, menu ou campo de uma janela pelo **nome** (ou AutomationId), esperando ele aparecer. É **mais confiável que "Clique" por coordenadas**: não depende de resolução nem de escala. Informe parte do título da janela e o nome do elemento (maiúsculas e acentos são ignorados); se houver vários, escolha a **posição**. Para descobrir nomes, use o Accessibility Insights. Só Windows; ⚠️ validar com `python scripts\verify-uia.py`.

## 12. Gravador
**Gravador → Iniciar gravação** captura o que você faz com o **mouse e o teclado** e transforma em um fluxo editável. O aplicativo é minimizado e uma **faixa vermelha sempre visível** mostra que está gravando. Atalhos: **Ctrl+Alt+R** para, **Ctrl+Alt+P** pausa/retoma, **Ctrl+Alt+S** liga/desliga o **modo senha** (o que você digitar nesse trecho **não é gravado**; o fluxo usará a variável `senha`, que você preenche depois).
Nada é salvo antes de você **revisar**: edite, apague ou reordene os passos e então "Criar automação" (que **não é executada** sozinha). "Descartar" apaga tudo da memória. Cliques viram **posições na tela** (frágeis se mudar a resolução ou a escala): ative a janela antes. Só Windows; requer `pip install -r engine\python\requirements-recorder.txt` no Python do motor. ⚠️ A captura real dentro do app, a faixa e os atalhos globais ainda não foram validados no Windows.

## 13. Visão (OCR)
O nó **Localizar texto na tela** (categoria "Visão (OCR)") procura um texto visível por OCR, **espera ele aparecer** e devolve a posição (`{{nodes.<id>.centerX}}` e `centerY`, para usar em **Clique**). Ignora maiúsculas e acentos; a **similaridade mínima** (padrão 0,8) tolera o ruído do OCR em texto pequeno. Limite a busca a uma **região** para ficar mais rápido e preciso. Só Windows; prefira janela/elemento quando existirem. Instale `engine\python\requirements-vision.txt` no Python do motor. Validado no Windows (`python scripts\verify-vision.py "texto"`).

O nó **Localizar imagem na tela** faz o mesmo com um **recorte** (PNG/JPG/BMP, 8–800 px, com detalhes). Faça o recorte **na mesma escala (zoom/DPI) e tema** em que o fluxo vai rodar — ele compara pixels, então mudar o DPI do Windows invalida o recorte. Similaridade padrão 0,9. Limite a **região** para ficar mais rápido (principalmente com recortes pequenos). ⚠️ Ainda não rodou no Windows: `python scripts\verify-vision.py --image C:\caminho\recorte.png`.

## 14. O que cada ação faz e seus limites
Referência completa em `docs/ACTIONS.md`. Em resumo: nenhuma ação **apaga** arquivos; copiar/mover checam conflitos antes de alterar e só substituem com "Sobrescrever" (confirmação na tela). Mouse e teclado têm o canto superior esquerdo da tela como botão de emergência (mover o mouse até lá interrompe).

## 15. Limitações conhecidas
- ⚠️ Ações de janela, teclado e mouse (abrir app, ativar janela, digitar, atalho, clique) só funcionam no Windows e ainda não foram validadas em máquina real; cliques por coordenada dependem de resolução e escala.
- Aplicativos executados como administrador podem ignorar teclado/mouse de um app sem elevação.
- Automação de interface não funciona com a sessão bloqueada ou o usuário desconectado.
 Automação web: sem login persistente, abas múltiplas, upload/download.
- Listas só vêm de "Listar arquivos" (até 2000 itens).

## 16. Seus dados, atualização e desinstalação
Os dados (automações, histórico, capturas) ficam em `%APPDATA%\Automation Studio`. **Atualizar** o aplicativo preserva tudo. **Desinstalar não apaga os dados** (para recomeçar do zero, apague essa pasta com o app fechado). Se um app mais antigo encontrar dados de uma versão mais nova, ele **não os abre** e pede para atualizar.

## 17. Problemas comuns
| Mensagem | O que fazer |
|---|---|
| Motor "Indisponível" | Python 3.11+ não encontrado; veja o motivo no Dashboard. |
| "Corrija os erros do fluxo antes de executar" | Abra **Problemas** e resolva os erros. |
| "Já existem arquivos…" | Conflito no destino; nada foi alterado. Renomeie ou ligue "Sobrescrever". |
| Execução "interrompida" no histórico | O app foi fechado durante a execução. |
