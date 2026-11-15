-- Ambilight Sync: starts the local sync service and opens the control panel.
-- Compiled by installa.command as a "stay open" applet (osacompile -s).

property panelURL : "http://127.0.0.1:8765/"

on supportDir()
	return (POSIX path of (path to application support folder from user domain)) & "AmbilightSync/"
end supportDir

on run
	startServer()
	if waitForServer(25) then
		openPanel()
	else
		display dialog "Ambilight Sync non è riuscito ad avviarsi." & return & return & ¬
			"Dettagli nel file:" & return & supportDir() & "ambisync.log" buttons {"OK"} default button 1 with icon caution
		quit
	end if
end run

on reopen
	if not serverRunning() then startServer()
	if waitForServer(15) then openPanel()
end reopen

on idle
	-- Closed from the panel ("Chiudi l'app") or stopped: close the Dock icon too.
	if not serverRunning() then
		delay 3
		if not serverRunning() then quit
	end if
	return 10
end idle

on quit
	stopServer()
	continue quit
end quit

on startServer()
	if serverRunning() then return
	set d to quoted form of supportDir()
	do shell script "cd " & d & " && find ambisync.log -size +2000k -exec mv {} ambisync.log.1 \\; 2>/dev/null; " & ¬
		"nohup ./venv/bin/python3 -m ambisync --no-browser >> ambisync.log 2>&1 & echo $! > server.pid"
end startServer

on serverRunning()
	try
		do shell script "curl -fsS -m 1 " & panelURL & "api/ping > /dev/null"
		return true
	on error
		return false
	end try
end serverRunning

on waitForServer(maxSeconds)
	repeat (maxSeconds * 4) times
		if serverRunning() then return true
		delay 0.25
	end repeat
	return false
end waitForServer

on openPanel()
	open location panelURL
end openPanel

on stopServer()
	try
		do shell script "curl -s -m 3 -X POST -H 'X-Ambisync: 1' -H 'Content-Type: application/json' -d '{}' " & panelURL & "api/quit > /dev/null"
	end try
	try
		do shell script "cd " & quoted form of supportDir() & " && sleep 1 && if [ -f server.pid ]; then kill $(cat server.pid) 2>/dev/null; rm -f server.pid; fi; true"
	end try
end stopServer
