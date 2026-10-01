package com.datalakeauth.registration

/** Enrollment evidence is session-local and requires open → closed → open eyes. */
class EnrollmentLivenessGate {
    enum class Decision { PENDING, READY, REJECT }
    private var sawOpen = false
    private var sawClosed = false
    var blinkPassed = false
        private set
    private var liveFrames = 0

    fun observe(eyesClosed: Boolean, isLive: Boolean, spoofScore: Float): Decision {
        if (!isLive || !spoofScore.isFinite() || spoofScore !in 0f..<0.45f) {
            reset()
            return Decision.REJECT
        }
        liveFrames++
        if (!eyesClosed) sawOpen = true
        if (sawOpen && eyesClosed) sawClosed = true
        if (sawClosed && !eyesClosed) blinkPassed = true
        return if (blinkPassed && liveFrames >= 5) Decision.READY else Decision.PENDING
    }

    fun reset() {
        sawOpen = false
        sawClosed = false
        blinkPassed = false
        liveFrames = 0
    }
}
