package com.datalakeauth.registration

import org.junit.Assert.*
import org.junit.Test
import com.datalakeauth.registration.EnrollmentLivenessGate.Decision

class EnrollmentLivenessGateTest {
    @Test fun staticOpenEyesCannotEnroll() {
        val gate = EnrollmentLivenessGate()
        repeat(100) { assertEquals(Decision.PENDING, gate.observe(false, true, 0.1f)) }
    }
    @Test fun staticClosedEyesCannotEnroll() {
        val gate = EnrollmentLivenessGate()
        repeat(100) { assertEquals(Decision.PENDING, gate.observe(true, true, 0.1f)) }
    }
    @Test fun blinkNeedsFiveLiveFrames() {
        val gate = EnrollmentLivenessGate()
        assertEquals(Decision.PENDING, gate.observe(false, true, 0.1f))
        assertEquals(Decision.PENDING, gate.observe(true, true, 0.1f))
        assertEquals(Decision.PENDING, gate.observe(false, true, 0.1f))
        assertEquals(Decision.PENDING, gate.observe(false, true, 0.1f))
        assertEquals(Decision.READY, gate.observe(false, true, 0.1f))
    }
    @Test fun initialClosedFrameIsNotABlink() {
        val gate = EnrollmentLivenessGate()
        gate.observe(true, true, 0.1f)
        repeat(10) { assertEquals(Decision.PENDING, gate.observe(false, true, 0.1f)) }
    }
    @Test fun spoofClearsEvidence() {
        val gate = EnrollmentLivenessGate()
        gate.observe(false, true, 0.1f)
        gate.observe(true, true, 0.1f)
        assertEquals(Decision.REJECT, gate.observe(false, false, 0.9f))
        repeat(10) { assertEquals(Decision.PENDING, gate.observe(false, true, 0.1f)) }
    }
    @Test fun invalidScoresFailClosed() {
        for (score in listOf(Float.NaN, Float.POSITIVE_INFINITY, -0.1f, 0.45f, 1f)) {
            assertEquals(Decision.REJECT, EnrollmentLivenessGate().observe(false, true, score))
        }
    }
    @Test fun resetCannotCarryBlinkToAnotherSession() {
        val gate = EnrollmentLivenessGate()
        gate.observe(false, true, 0.1f)
        gate.observe(true, true, 0.1f)
        gate.observe(false, true, 0.1f)
        gate.reset()
        repeat(10) { assertEquals(Decision.PENDING, gate.observe(false, true, 0.1f)) }
    }
}
